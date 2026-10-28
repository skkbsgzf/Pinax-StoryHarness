import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_KINDS, validateRelativePath } from '../kernel/projectSkeleton.mjs'
import { CAPABILITY_IDS } from '../kernel/capabilities.vocab.mjs'
import { kernelToolNames } from '../runtime/mcpSurface.mjs'
import { NOVEL_CARRIER, SETTING_CARRIER } from '../carriers/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

/**
 * 中文骨架只有一份真源：服务端 KIND_TEMPLATES（已合入主干，MCP 19 工具与 bootstrap skill 都按它写死）。
 * Next 不 import 服务端模块（避免把 Express 轨拖进内核），所以用源码文本把两边钉死：
 * 谁改了其中一边，这条测试立刻红。
 */
test('Next 的固化骨架与服务端 KIND_TEMPLATES 完全一致', async () => {
  const source = await readFile(join(repoRoot, 'server', 'services', 'localMirrorService.js'), 'utf-8')
  const block = /export const KIND_TEMPLATES = \{([\s\S]*?)\n\}/.exec(source)
  assert.ok(block, '服务端 KIND_TEMPLATES 结构变了，Next 骨架对照要同步改')
  const parsed = {}
  for (const line of block[1].split('\n')) {
    const match = /^\s*(\w+):\s*\[([^\]]*)\],?\s*$/.exec(line)
    if (!match) continue
    parsed[match[1]] = match[2].split(',').map((item) => item.trim().replace(/^'|'$/g, '')).filter(Boolean)
  }
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(PROJECT_KINDS).sort())
  for (const kind of Object.keys(PROJECT_KINDS)) {
    assert.deepEqual(parsed[kind], [...PROJECT_KINDS[kind]], `${kind} 的中文目录两边不一致`)
  }
})

test('C2 路径规则：中文目录正常，越界与 .pinax 直写全拒', () => {
  assert.equal(validateRelativePath('正文/第001章.md').ok, true)
  assert.equal(validateRelativePath('世界书/角色/李二.md').ok, true)
  const outside = ['../逃逸.md', '/绝对/路径.md', 'C:/Windows/x.md', '.pinax/project.json', '正文/../.pinax/project.json', '..']
  for (const bad of outside) {
    const result = validateRelativePath(bad)
    assert.equal(result.ok, false, `应拒绝：`)
    assert.equal(result.error.code, 'PINAX_PATH_OUTSIDE_PROJECT', bad)
  }
  assert.equal(validateRelativePath('').error.code, 'PINAX_INVALID_INPUT', '空串是输入问题，不是越界')
  assert.equal(validateRelativePath(null).error.code, 'PINAX_INVALID_INPUT')
})

/**
 * M2 门禁口径（替换 M1 的「carriers/ 必须为空」）。
 * 判据从「不许有插件」换成「插件必须守规矩」，四条都可机读：
 *   1) 随框架发布的只有 novel / setting 两块，且都是 JS 清单——不允许散落 .carrier.json（那会绕过校验器）；
 *   2) 板块认领的目录互不重叠（C3 一目录一主人），且都落在固化中文骨架的并集里；
 *   3) 认领的工具名必须是内核 19 里已有的（不许虚增工具面）；载体的自有工具逐条点名，加了要留名；
 *   4) 每块板块的 dataDirs 与 scopes 必须一一对应——声明了目录却没申请权限，或反过来，都算清单说谎。
 */
const CARRIER_OWN_TOOL_ALLOWLIST = Object.freeze(['pinax_chapter_save', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_worldbook_save'])

test('M2 口径：next/carriers 发布小说＋设定两块，目录不重叠且落在中文骨架并集里', async () => {
  const carriersDir = join(repoRoot, 'next', 'carriers')
  const entries = await readdir(carriersDir)
  const stray = entries.filter((name) => name.endsWith('.carrier.json') || name === 'manifests.json')
  assert.deepEqual(stray, [], '清单只允许写在 manifest.mjs 里过校验器，散落 JSON 会绕过 C1–C8')
  const published = entries.filter((name) => !name.startsWith('.'))
  assert.deepEqual(published.filter((name) => name.endsWith('.mjs')).sort(), ['index.mjs'])
  assert.deepEqual(published.filter((name) => !name.includes('.')).sort(), ['novel', 'setting'])

  const kernel = new Set(kernelToolNames())
  const skeletonUnion = new Set(Object.values(PROJECT_KINDS).flat())
  const dirs = new Set()
  for (const manifest of [NOVEL_CARRIER, SETTING_CARRIER]) {
    for (const dir of Object.values(manifest.dataDirs)) {
      assert.equal(skeletonUnion.has(dir), true, `${manifest.id} 的目录「${dir}」不在固化骨架里`)
      assert.equal(dirs.has(dir), false, `目录「${dir}」被两块板块同时认领（C3 一目录一主人）`)
      dirs.add(dir)
      const scope = manifest.scopes.find((item) => item.startsWith(`file:${dir}:`))
      assert.ok(scope, `${manifest.id} 认领了「${dir}」却没申请 file:${dir}:r|rw`)
    }
    for (const scope of manifest.scopes.filter((item) => item.startsWith('file:'))) {
      const dir = scope.split(':')[1]
      assert.ok(Object.values(manifest.dataDirs).includes(dir), `${manifest.id} 申请了未认领的目录权限：${scope}`)
    }
    for (const name of manifest.tools) {
      assert.equal(kernel.has(name) || CARRIER_OWN_TOOL_ALLOWLIST.includes(name), true,
        `${manifest.id} 声明的工具 ${name} 既不在内核 19 里，也没进「载体自有工具」白名单`)
    }
  }
  // 自有工具（内核没有的新名字）逐条点名：新增必须在这里留名，防止有人偷偷扩面。
  // 工单B1 起这份名单不再只有写口：构思的 pinax_notes_list 也是载体自有（列与读合在一把里，没有内核名可认领）。
  const own = [NOVEL_CARRIER, SETTING_CARRIER].flatMap((manifest) => manifest.tools.filter((name) => !kernel.has(name)))
  assert.deepEqual(own, CARRIER_OWN_TOOL_ALLOWLIST, '自有工具逐条留名：小说的 pinax_chapter_save、pinax_outline_save（工单B2）、构思这对 pinax_notes_list/pinax_notes_save（工单B1）与提案三把 pinax_proposal_list/read/discard（工单A）＋ 设定的 pinax_worldbook_save（工单A2；断言同步，调度方裁定 dwfq-f2369ffa-3）')
})

test('能力词表非空且每条有中文名，闭包才算得动', () => {
  assert.ok(CAPABILITY_IDS.length >= 10)
  assert.equal(CAPABILITY_IDS.includes('script.scenes'), true, 'D4 的靶子能力必须在词表里')
  assert.equal(CAPABILITY_IDS.includes('text.chapters'), true)
})

test('目录存在性探针自检（工装不误报）', async () => {
  const info = await stat(repoRoot)
  assert.equal(info.isDirectory(), true)
})
