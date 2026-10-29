import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import {
  BUILT_IN_CARRIER_PLUGINS,
  NOVEL_CARRIER_ID,
  OUTLINE_CARRIER_ID,
  SETTING_CARRIER_ID,
  WORLDBOOK_CARRIER_ID
} from '../carriers/index.mjs'
import { parseSkillMarkdown, loadSkills, skillCatalogLines, DEFAULT_SKILLS_DIR } from '../skills/loadSkills.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 技能包（M2.5-B · 任务一）。
 *
 * 这一组证四件事：
 *   1) frontmatter 是硬合同：缺字段、名字与目录不一致、output 不在词表里，一律不装载；
 *   2) tools 必须都在这一刻的面上——少一把就不装载并记账，绝不虚列；
 *   3) 装载成功的技能只进「一行描述」的清单，正文要调 pinax_skill_read 才展开；
 *   4) 未知技能名如实报 INVALID_INPUT，不做模糊匹配。
 */

const MARKDOWN = `---
name: demo
description: 一句话说清这个技能干什么。
tools: [pinax_outline_read, pinax_outline_save]
output: proposal
---

## 步骤

1. 先读。
`

test('frontmatter 硬合同：缺字段／名字不符／output 不在词表／没有正文，一律解析失败', () => {
  const ok = parseSkillMarkdown(MARKDOWN, { nameHint: 'demo' })
  assert.equal(ok.ok, true, JSON.stringify(ok.error ?? {}))
  assert.deepEqual(ok.value.tools, ['pinax_outline_read', 'pinax_outline_save'])
  assert.equal(ok.value.output, 'proposal')
  assert.match(ok.value.body, /## 步骤/)

  const noFront = parseSkillMarkdown('# 没有 frontmatter', { nameHint: 'x' })
  assert.equal(noFront.ok, false)
  assert.equal(noFront.error.code, 'SKILL_FRONTMATTER_MISSING')

  const noDesc = parseSkillMarkdown('---\nname: demo\ntools: [a]\noutput: proposal\n---\n正文', { nameHint: 'demo' })
  assert.equal(noDesc.error.code, 'SKILL_DESCRIPTION_REQUIRED')

  const noTools = parseSkillMarkdown('---\nname: demo\ndescription: x\noutput: proposal\n---\n正文', { nameHint: 'demo' })
  assert.equal(noTools.error.code, 'SKILL_TOOLS_REQUIRED', '没有方法落点的技能不装载')

  const badOutput = parseSkillMarkdown('---\nname: demo\ndescription: x\ntools: [a]\noutput: prompt\n---\n正文', { nameHint: 'demo' })
  assert.equal(badOutput.error.code, 'SKILL_OUTPUT_INVALID')

  const mismatch = parseSkillMarkdown(MARKDOWN, { nameHint: 'other' })
  assert.equal(mismatch.error.code, 'SKILL_NAME_MISMATCH', '两套名字会让「调哪份」不可判定')

  const noBody = parseSkillMarkdown('---\nname: demo\ndescription: x\ntools: [a]\noutput: proposal\n---\n', { nameHint: 'demo' })
  assert.equal(noBody.error.code, 'SKILL_BODY_REQUIRED')
})

test('块状 tools 也认：换行 - 每条是合法 YAML 写法', () => {
  const ok = parseSkillMarkdown('---\nname: demo\ndescription: x\ntools:\n  - a\n  - b\noutput: checklist\n---\n正文', { nameHint: 'demo' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value.tools, ['a', 'b'])
})

test('工具不在面上就不装载：rejected 逐条记账，不静默吞', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-'))
  await mkdir(join(dir, 'good'))
  await writeFile(join(dir, 'good', 'SKILL.md'), '---\nname: good\ndescription: 可以装。\ntools: [a]\noutput: checklist\n---\n正文', 'utf-8')
  await mkdir(join(dir, 'missing-tool'))
  await writeFile(join(dir, 'missing-tool', 'SKILL.md'), '---\nname: missing-tool\ndescription: 少一把。\ntools: [a, zzz]\noutput: checklist\n---\n正文', 'utf-8')
  await mkdir(join(dir, 'broken'))
  await writeFile(join(dir, 'broken', 'SKILL.md'), '没有 frontmatter', 'utf-8')
  await mkdir(join(dir, 'empty-dir'))

  const loaded = await loadSkills({ dir, availableTools: ['a', 'pinax_skill_read'] })
  assert.deepEqual(loaded.skills.map((skill) => skill.name), ['good'])
  const codes = loaded.rejected.map((item) => item.code).sort()
  assert.deepEqual(codes, ['SKILL_FILE_MISSING', 'SKILL_FRONTMATTER_MISSING', 'SKILL_TOOLS_NOT_ON_SURFACE'])
  const missing = loaded.rejected.find((item) => item.code === 'SKILL_TOOLS_NOT_ON_SURFACE')
  assert.match(missing.message, /zzz/, '记账里要点名缺的是哪把工具')
})

test('随框架发布的五个技能：宽项目全装，窄项目如实少装', async () => {
  const wide = await loadSkills({
    dir: DEFAULT_SKILLS_DIR,
    availableTools: [
      'pinax_project_context',
      'pinax_chapter_read',
      'pinax_chapter_save',
      'pinax_outline_read',
      'pinax_outline_save',
      'pinax_worldbook_list',
      'pinax_worldbook_read',
      'pinax_worldbook_save',
      'pinax_skill_read'
    ]
  })
  assert.deepEqual(
    wide.skills.map((skill) => skill.name).sort(),
    ['chapter-rewrite', 'continuity-check', 'outline-restructure', 'scene-expand', 'worldbook-refactor']
  )
  assert.deepEqual(wide.rejected, [])

  // 只有小说载体的窄项目：大纲/世界书技能不该装——它们声明的写工具不在面上。
  const narrow = await loadSkills({
    dir: DEFAULT_SKILLS_DIR,
    availableTools: ['pinax_project_context', 'pinax_chapter_read', 'pinax_worldbook_list', 'pinax_chapter_save', 'pinax_skill_read']
  })
  assert.deepEqual(narrow.skills.map((skill) => skill.name).sort(), ['chapter-rewrite', 'continuity-check', 'scene-expand'])
  assert.equal(narrow.rejected.length, 2)
  assert.equal(narrow.rejected.every((item) => item.code === 'SKILL_TOOLS_NOT_ON_SURFACE'), true)
})

test('清单只要一行：名字＋一句话＋产物，正文不进去（渐进披露）', () => {
  const lines = skillCatalogLines([
    { name: 'outline-restructure', description: '重构大纲结构。', output: 'proposal' },
    { name: 'continuity-check', description: '连续性核对。', output: 'checklist' }
  ])
  assert.deepEqual(lines, [
    '- outline-restructure：重构大纲结构。（产物：proposal）',
    '- continuity-check：连续性核对。（产物：checklist）'
  ])
  assert.equal(lines.join('\n').includes('## 步骤'), false, '系统提示里不许出现技能正文')
})

async function skillProject(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '技能靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    assert.equal(registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {}).ok, true)
  }
  const created = await createProject({
    root,
    name: '技能靶子',
    primaryCarrier: NOVEL_CARRIER_ID,
    registry,
    extraEnabled: [OUTLINE_CARRIER_ID, WORLDBOOK_CARRIER_ID, SETTING_CARRIER_ID]
  })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  await runtime.start()
  return { workspace, runtime }
}

test('运行时面：技能清单与 pinax_skill_read 都到位，未知技能报 INVALID_INPUT', async () => {
  const { workspace, runtime } = await skillProject('skills-surface')
  try {
    const skills = runtime.skills()
    assert.equal(skills.names.length, 5, `装载了 ${skills.names.length} 个：${skills.rejected.map((item) => item.dir).join('、')}`)
    assert.deepEqual(skills.rejected, [])
    assert.ok(runtime.listTools().some((tool) => tool.name === 'pinax_skill_read'))
    const skillTool = runtime.listTools().find((tool) => tool.name === 'pinax_skill_read')
    assert.equal(skillTool.annotations.readOnlyHint, true, '读技能不写盘')

    const read = await runtime.callTool('pinax_skill_read', { name: 'outline-restructure' })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload ?? {}))
    assert.equal(read.value.payload.output, 'proposal')
    assert.deepEqual(read.value.payload.tools, ['pinax_outline_read', 'pinax_outline_save'])
    assert.match(read.value.payload.body, /## 步骤/, '正文是整份方法说明，不是一句话')
    assert.match(read.value.payload.body, /pinax_outline_save/, '正文要点名它真的会落哪把工具')

    const unknown = await runtime.callTool('pinax_skill_read', { name: 'no-such-skill' })
    assert.equal(unknown.ok, true, '运行时调用本身成功，失败在工具结果里')
    assert.equal(unknown.value.ok, false)
    assert.equal(unknown.value.payload.code, 'INVALID_INPUT')
    assert.match(unknown.value.payload.message, /没有这个技能/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
