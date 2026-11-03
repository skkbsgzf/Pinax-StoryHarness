import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  SKILL_DOMAINS,
  SKILL_DOMAIN_LABELS,
  SKILL_KINDS,
  SKILL_UNDOMAINED_LABEL,
  SKILL_PREFS_DIR,
  SKILL_PREFS_FILENAME,
  SKILL_IMPORT_DIRNAME,
  DEFAULT_SKILLS_DIR,
  parseSkillMarkdown,
  loadSkills,
  skillDomainLabel,
  enabledSkillList,
  readSkillPreferencesSync,
  skillPreferencesPath,
  projectSkillsDir,
  createFileSkillPreferencesStore,
  createSkillsService,
  importSkillDirectory,
  skillCatalogLines
} from '../skills/loadSkills.mjs'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'

/**
 * 技能库设置面与 `domain` 字段（批次77 任务5）。
 *
 * 工单的四条验收判据在本文件逐条钉住：
 *   1) 缺 `domain` 仍能装载，并进「未分域」（向后兼容：老包不改也能用）；
 *   2) 非法 `domain` 报明确原因（词表是哪几个、不写会怎样）；
 *   3) 关掉技能后系统提示清单里不再有它（真跑一遍 advisor 那条拼提示词的链）；
 *   4) 工具不在面上整包拒装时，设置面能看到原因（守卫⑪，不许退化成空态）。
 * 判据 3 走的是运行器那一层，所以这里带一个桩循环：断的是「提示词里那一行没了」，不是某个内部布尔。
 */

const BODY = '## 步骤\n\n1. 先读。\n'

function markdown({ domain, kind, name = 'demo', description = '一句话说清这个技能干什么。', tools = ['pinax_chapter_read'], output = 'checklist' } = {}) {
  const lines = ['---', `name: ${name}`, `description: ${description}`, `tools: [${tools.join(', ')}]`, `output: ${output}`]
  if (domain !== undefined) lines.push(`domain: ${domain}`)
  if (kind !== undefined) lines.push(`kind: ${kind}`)
  lines.push('---', '', BODY)
  return lines.join('\n')
}

/** 造一个「项目根」：只要目录存在就够，启停与导入读写的都是它里面的 .pinax/。 */
async function fakeProject(label) {
  const root = await mkdtemp(join(tmpdir(), `pinax-skills-${label}-`))
  return root
}

async function putSkill(dir, name, text) {
  await mkdir(join(dir, name), { recursive: true })
  await writeFile(join(dir, name, 'SKILL.md'), text, 'utf-8')
}

async function writeDisabled(root, value) {
  await mkdir(join(root, SKILL_PREFS_DIR), { recursive: true })
  await writeFile(skillPreferencesPath(root), typeof value === 'string' ? value : JSON.stringify(value), 'utf-8')
}

/* ───────────── 判据 1／2：domain 是「可缺不可错」 ───────────── */

test('〔批次77 任务5·判据1〕缺 domain 照样装载，归到「未分域」', async () => {
  const parsed = parseSkillMarkdown(markdown(), { nameHint: 'demo' })
  assert.equal(parsed.ok, true, JSON.stringify(parsed.error ?? {}))
  assert.equal(parsed.value.domain, '', '缺这一行就是空串，不是猜一个域')
  assert.equal(parsed.value.kind, '')
  assert.equal(skillDomainLabel(parsed.value.domain), SKILL_UNDOMAINED_LABEL)

  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-undomain-'))
  await putSkill(dir, 'demo', markdown())
  const loaded = await loadSkills({ dir, availableTools: ['pinax_chapter_read'] })
  assert.deepEqual(loaded.skills.map((item) => item.name), ['demo'], '老的包不改 frontmatter 也照样能装')
  assert.deepEqual(loaded.rejected, [])
})

test('〔批次77 任务5·判据2〕非法 domain 拒装并说清词表与「不写会怎样」', () => {
  const bad = parseSkillMarkdown(markdown({ domain: 'romance' }), { nameHint: 'demo' })
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'SKILL_DOMAIN_INVALID')
  for (const domain of SKILL_DOMAINS) assert.match(bad.error.message, new RegExp(domain, 'u'), '原因里要能把词表抄下来')
  assert.match(bad.error.message, /编剧/u)
  assert.match(bad.error.message, new RegExp(SKILL_UNDOMAINED_LABEL, 'u'), '要告诉作者不写这一行就是未分域')

  const badKind = parseSkillMarkdown(markdown({ domain: 'prose', kind: 'voice' }), { nameHint: 'demo' })
  assert.equal(badKind.error.code, 'SKILL_KIND_INVALID')
  assert.match(badKind.error.message, new RegExp(SKILL_KINDS.join('|'), 'u'))
})

test('〔批次77 任务5〕四个域各有中文说法；kind 词表今天只有「风格」', () => {
  assert.deepEqual(SKILL_DOMAINS.slice(), ['screenwriting', 'prose', 'worldbook', 'acceptance'])
  assert.deepEqual(SKILL_DOMAINS.map((item) => SKILL_DOMAIN_LABELS[item]), ['编剧', '正文写作', '世界书整理', '审阅验收'])
  assert.deepEqual(SKILL_KINDS.slice(), ['style'])
})

test('〔批次77 任务5〕随包五份技能都补齐了 domain，且都在词表内', async () => {
  const loaded = await loadSkills({
    dir: DEFAULT_SKILLS_DIR,
    availableTools: [
      'pinax_project_context', 'pinax_chapter_read', 'pinax_chapter_save',
      'pinax_outline_read', 'pinax_outline_save', 'pinax_worldbook_list',
      'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_skill_read'
    ]
  })
  assert.deepEqual(loaded.rejected, [])
  assert.equal(loaded.skills.length, 5)
  for (const skill of loaded.skills) {
    assert.ok(SKILL_DOMAINS.includes(skill.domain), `${skill.name} 的 domain「${skill.domain}」不在词表里`)
    assert.notEqual(skillDomainLabel(skill.domain), SKILL_UNDOMAINED_LABEL, `${skill.name} 还没分域`)
  }
})

/* ───────────── 启停真值：项目内 .pinax/skills.json ───────────── */

test('〔批次77 任务5〕关掉的从装载清单剔除、进 disabledSkills（设置面要列得出来）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-two-'))
  await putSkill(dir, 'alpha', markdown({ name: 'alpha' }))
  await putSkill(dir, 'beta', markdown({ name: 'beta' }))
  const root = await fakeProject('disabled')
  await writeDisabled(root, { version: 1, disabled: ['beta'] })

  const loaded = await loadSkills({ dir, availableTools: ['pinax_chapter_read'], projectRoot: root })
  assert.deepEqual(loaded.skills.map((item) => item.name), ['alpha'])
  assert.deepEqual(loaded.disabledSkills.map((item) => item.name), ['beta'], '「停用」不能等于「消失」')
  assert.deepEqual(loaded.disabled, ['beta'])
  assert.deepEqual(loaded.rejected, [])
  assert.deepEqual(enabledSkillList(loaded.skills, loaded.disabled).map((item) => item.name), ['alpha'], '装载层与 advisor 共用这一个谓词')
})

test('〔批次77 任务5〕启停表坏了不崩：按「全部启用」继续并记账', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-broken-'))
  await putSkill(dir, 'alpha', markdown({ name: 'alpha' }))
  const root = await fakeProject('broken-prefs')
  await writeDisabled(root, '{ 这不是 JSON')

  const prefs = readSkillPreferencesSync(root)
  assert.deepEqual(prefs.disabled, [])
  assert.deepEqual(prefs.warnings, ['SKILLS_PREFS_BAD_JSON'])
  const loaded = await loadSkills({ dir, availableTools: ['pinax_chapter_read'], projectRoot: root })
  assert.deepEqual(loaded.skills.map((item) => item.name), ['alpha'], '坏档不许把整条装载打断')
})

test('〔批次77 任务5〕启停落盘：没有文件＝全部启用；写进去的读得回来；内容没变不重写', async () => {
  const root = await fakeProject('store')
  assert.equal(readSkillPreferencesSync(root).exists, false)

  const store = createFileSkillPreferencesStore({ root })
  assert.equal(skillPreferencesPath(root), join(root, SKILL_PREFS_DIR, SKILL_PREFS_FILENAME), '落点就是项目内那一份，不写全局偏好')
  const first = await store.setDisabled('alpha', true)
  assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
  assert.equal(first.value.skipped, false)
  assert.equal(JSON.parse(await readFile(skillPreferencesPath(root), 'utf-8')).disabled.join(), 'alpha')

  const second = await store.setDisabled('alpha', true)
  assert.equal(second.value.skipped, true, '同样的名单不重复写盘')
  const back = await store.setDisabled('alpha', false)
  assert.deepEqual(back.value.disabled, [])
})

/* ───────────── 两层目录与同名仲裁 ───────────── */

test('〔批次77 任务5〕`.pinax/skills/` 那层一起扫；同名时随包那份赢，让位那条有记账', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-built-'))
  await putSkill(dir, 'alpha', markdown({ name: 'alpha', description: '随包那一份。' }))
  const root = await fakeProject('layers')
  const imported = join(root, SKILL_PREFS_DIR, SKILL_IMPORT_DIRNAME)
  await putSkill(imported, 'alpha', markdown({ name: 'alpha', description: '项目里同名的一份。' }))
  await putSkill(imported, 'gamma', markdown({ name: 'gamma' }))

  const loaded = await loadSkills({ dir, availableTools: ['pinax_chapter_read'], projectRoot: root })
  assert.deepEqual(loaded.skills.map((item) => item.name).sort(), ['alpha', 'gamma'])
  assert.equal(loaded.skills.find((item) => item.name === 'alpha').description, '随包那一份。')
  assert.equal(loaded.skills.find((item) => item.name === 'gamma').origin, 'project')
  const dupe = loaded.rejected.find((item) => item.code === 'SKILL_NAME_DUPLICATE')
  assert.match(dupe.message, /不覆盖官方方法/u)
  assert.deepEqual(loaded.layers.map((layer) => layer.origin), ['built-in', 'project'])
  assert.equal(loaded.layers[1].exists, true)
})

test('〔批次77 任务5〕没有 `.pinax/skills/` 是常态：标 exists:false，不记成拒装', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-onelayer-'))
  await putSkill(dir, 'alpha', markdown({ name: 'alpha' }))
  const root = await fakeProject('no-import-layer')
  const loaded = await loadSkills({ dir, availableTools: ['pinax_chapter_read'], projectRoot: root })
  assert.deepEqual(loaded.rejected, [], '没导入过不是错误，别往拒装账上刷噪音')
  assert.equal(loaded.layers[1].exists, false)
})

/* ───────────── 判据 3：关掉技能后系统提示清单里不再有它 ───────────── */

function fakeEnvelope() {
  return {
    ok: true,
    value: {
      taskType: 'authoring.review.chapter',
      capability: 'text',
      profile: 'writing-chapter',
      missingKinds: [],
      warnings: [],
      envelope: {
        target: { type: 'chapter', revision: 'r1' },
        blocks: [{ kind: 'selection', priority: 1000, sourceRefs: [], content: '雪' }],
        budget: { usedChars: 10, maxChars: 24_000, truncated: false }
      }
    }
  }
}

async function promptWithDisabled(disabled) {
  const root = await fakeProject('advisor')
  if (disabled !== null) await writeDisabled(root, { version: 1, disabled })
  const catalog = [
    { name: 'chapter-rewrite', description: '改写这一章。', tools: ['pinax_chapter_read'], output: 'proposal', domain: 'prose' },
    { name: 'continuity-check', description: '核对连续性。', tools: ['pinax_chapter_read'], output: 'checklist', domain: 'acceptance' }
  ]
  let prompt = ''
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeEnvelope(),
    toolLoop: {
      async run(input) {
        prompt = input.buildUserMessage({ question: '看这一章', envelope: input.envelope })
        return { kind: 'final', text: '好', steps: [], calls: [], dropped: [] }
      }
    }
  })
  const runtime = {
    contextSources: () => ({ registry: {}, view: { root }, fileService: {} }),
    listTools: () => [],
    skills: () => ({ names: catalog.map((item) => item.name), rejected: [], catalog })
  }
  const answer = await runner({ question: '看这一章', runtime })
  assert.equal(answer.ok, true)
  return prompt
}

test('〔批次77 任务5·判据3〕关掉的那条从系统提示的技能清单里消失（每一问现读启停表）', async () => {
  const both = await promptWithDisabled(null)
  assert.match(both, /chapter-rewrite/u)
  assert.match(both, /continuity-check/u)

  const off = await promptWithDisabled(['continuity-check'])
  assert.match(off, /chapter-rewrite/u)
  assert.doesNotMatch(off, /continuity-check/u, '关掉＝提示词里不再有它，不是只从屏上消失')
  assert.equal(off.includes(BODY), false, '渐进披露那道闸：清单里永远不许出现技能正文')
})

test('〔批次77 任务5〕清单那一行仍是「名字＋一句话＋产物」（技能域不进提示词）', () => {
  const lines = skillCatalogLines([{ name: 'alpha', description: '一句话说清。', output: 'checklist', domain: 'prose' }])
  assert.deepEqual(lines, ['- alpha：一句话说清。（产物：checklist）'])
})

/* ───────────── 判据 4／守卫⑪：设置面看得到拒装原因 ───────────── */

function serviceFor({ root, tools, dir }) {
  return createSkillsService({
    getRoot: () => root,
    getAvailableTools: () => tools.map((name) => ({ name })),
    load: (options) => loadSkills({ ...options, dir })
  })
}

test('〔批次77 任务5·判据4／守卫⑪〕整包拒装时设置面逐条给原因，不是空态；行里不带正文', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-panel-'))
  await putSkill(dir, 'ok-one', markdown({ name: 'ok-one', domain: 'prose' }))
  await putSkill(dir, 'needs-mcp', markdown({ name: 'needs-mcp', tools: ['pinax_chapter_read', 'comfy_submit'] }))
  await putSkill(dir, 'bad-head', '没有 frontmatter')
  const root = await fakeProject('panel')

  const listed = await serviceFor({ root, tools: ['pinax_chapter_read'], dir }).list()
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.rows.map((row) => row.name), ['ok-one'])
  assert.equal(listed.value.rows[0].domainLabel, '正文写作')
  assert.equal(listed.value.rows[0].originLabel, '随包')
  assert.equal('body' in listed.value.rows[0], false, '清单里不带正文')

  const codes = listed.value.rejected.map((item) => item.code).sort()
  assert.deepEqual(codes, ['SKILL_FRONTMATTER_MISSING', 'SKILL_TOOLS_NOT_ON_SURFACE'])
  const surface = listed.value.rejected.find((item) => item.code === 'SKILL_TOOLS_NOT_ON_SURFACE')
  assert.equal(surface.dir, 'needs-mcp')
  assert.match(surface.message, /comfy_submit/u, '缺哪把工具要点名')
  assert.equal(listed.value.surface.started, true)
})

test('〔批次77 任务5〕工具面还没装配时说实话：不是「没有技能」，是「面上还没有工具」', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-nostart-'))
  await putSkill(dir, 'ok-one', markdown({ name: 'ok-one' }))
  const listed = await serviceFor({ root: await fakeProject('nostart'), tools: [], dir }).list()
  assert.equal(listed.value.surface.started, false)
  assert.match(listed.value.surface.note, /工具面还没装配/u)
  assert.deepEqual(listed.value.rejected.map((item) => item.code), ['SKILL_TOOLS_NOT_ON_SURFACE'])
})

test('〔批次77 任务5〕没有项目根：四条都如实报缺，不写一个字节', async () => {
  const service = createSkillsService({ getRoot: () => null })
  for (const call of [() => service.list(), () => service.toggle('alpha', false), () => service.body('alpha'), () => service.importFrom('/tmp/x')]) {
    const result = await call()
    assert.equal(result.ok, false)
    assert.match(result.error.message, /先打开一个项目/u)
  }
})

test('〔批次77 任务5〕启停走服务：写进项目内那份文件、清单随之翻转；没听过的名字不写脏名单', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-toggle-'))
  await putSkill(dir, 'alpha', markdown({ name: 'alpha' }))
  const root = await fakeProject('toggle')
  const service = serviceFor({ root, tools: ['pinax_chapter_read'], dir })

  const off = await service.toggle('alpha', false)
  assert.equal(off.ok, true, JSON.stringify(off.error ?? {}))
  assert.equal(off.value.enabled, false)
  assert.deepEqual(JSON.parse(await readFile(skillPreferencesPath(root), 'utf-8')).disabled, ['alpha'])
  const after = await service.list()
  assert.deepEqual(after.value.rows.map((row) => [row.name, row.enabled]), [['alpha', false]])
  assert.deepEqual(after.value.disabled, ['alpha'])

  const ghost = await service.toggle('no-such-skill', false)
  assert.equal(ghost.ok, false)
  assert.equal(ghost.error.code, 'PINAX_SKILL_NOT_FOUND')
  assert.deepEqual(JSON.parse(await readFile(skillPreferencesPath(root), 'utf-8')).disabled, ['alpha'], '被拒的写入不落盘')
})

test('〔批次77 任务5·判据4〕装不上的那条连「看正文」也要给出同一句原因（不许只回「没有这个技能」）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skills-body-'))
  await putSkill(dir, 'ok-one', markdown({ name: 'ok-one' }))
  await putSkill(dir, 'needs-mcp', markdown({ name: 'needs-mcp', tools: ['pinax_chapter_read', 'comfy_submit'] }))
  const root = await fakeProject('body')
  await writeDisabled(root, { version: 1, disabled: ['ok-one'] })
  const service = serviceFor({ root, tools: ['pinax_chapter_read'], dir })

  // 关掉的那条仍读得到正文：设置面的用途是让作者看看自己关掉了什么，渐进披露管的是系统提示。
  const disabledBody = await service.body('ok-one')
  assert.equal(disabledBody.ok, true)
  assert.match(disabledBody.value.body, /先读。/u)

  const rejectedBody = await service.body('needs-mcp')
  assert.equal(rejectedBody.ok, false)
  assert.equal(rejectedBody.error.details.rejectedCode, 'SKILL_TOOLS_NOT_ON_SURFACE')
  assert.match(rejectedBody.error.message, /comfy_submit/u)

  const unknown = await service.body('no-such')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'SKILL_NOT_FOUND', '既没装载也没拒装记录的名字：装载层那句原样交回来')
})

/* ───────────── 导入：拷进 .pinax/skills/ 后逐条校验 ───────────── */

test('〔批次77 任务5〕导入认「一个包」，落点在项目内 .pinax/skills/，导入后即可装载', async () => {
  const source = await mkdtemp(join(tmpdir(), 'pinax-skill-src-'))
  await putSkill(source, 'imported-one', markdown({ name: 'imported-one', domain: 'screenwriting' }))
  const root = await fakeProject('import-one')

  const result = await importSkillDirectory({ sourceDir: source, projectRoot: root })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.imported.map((item) => item.name), ['imported-one'])
  assert.deepEqual(result.value.rejected, [])
  assert.equal(result.value.source, projectSkillsDir(root))

  // 随包层给一个不存在的目录：这一条只证「项目里那层货架能单独把包供上来」，不与同名仲裁混在一起。
  const loaded = await loadSkills({ dir: join(root, '没有随包层'), availableTools: ['pinax_chapter_read'], projectRoot: root })
  assert.deepEqual(loaded.skills.map((item) => item.name), ['imported-one'], '项目层那份是随包之外的第二层货架')
  assert.equal(loaded.skills[0].origin, 'project')
  assert.equal(loaded.skills[0].domain, 'screenwriting')
  assert.deepEqual(loaded.rejected, [])
})

test('〔批次77 任务5〕导入不合格逐条列原因，不假装成功', async () => {
  const source = await mkdtemp(join(tmpdir(), 'pinax-skill-src-bad-'))
  await mkdir(join(source, '坏包'), { recursive: true })
  await writeFile(join(source, '坏包', 'SKILL.md'), markdown({ name: '别的名字' }), 'utf-8')
  await mkdir(join(source, '域写错'), { recursive: true })
  await writeFile(join(source, '域写错', 'SKILL.md'), markdown({ name: '域写错', domain: 'romance' }), 'utf-8')
  await mkdir(join(source, '没有技能文件'), { recursive: true })
  const root = await fakeProject('import-bad')

  const result = await importSkillDirectory({ sourceDir: source, projectRoot: root })
  assert.equal(result.ok, true, '导入这件事本身成了：拒装是结果里的账，不是通道级失败')
  assert.deepEqual(result.value.imported, [])
  const codes = result.value.rejected.map((item) => item.code).sort()
  assert.deepEqual(codes, ['SKILL_DOMAIN_INVALID', 'SKILL_FILE_MISSING', 'SKILL_NAME_MISMATCH'])
  assert.equal(result.value.total, 3)
})

test('〔批次77 任务5〕源目录既没 SKILL.md 也没子目录：如实说一句，不建空层', async () => {
  const source = await mkdtemp(join(tmpdir(), 'pinax-skill-src-empty-'))
  const root = await fakeProject('import-empty')
  const result = await importSkillDirectory({ sourceDir: source, projectRoot: root })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PINAX_SKILLS_SOURCE_EMPTY')
})

/* ───────────── 四条通道 ───────────── */

test('〔批次77 任务5〕四条 skills:* 都在通道白名单里（preload 因此自动放行，不用改第二份表）', () => {
  for (const key of ['skillsList', 'skillsToggle', 'skillsBody', 'skillsImport']) {
    assert.ok(String(IPC_CHANNELS[key]).startsWith('pinax:agent:skills:'), key)
  }
})

test('〔批次77 任务5〕没接线时如实报缺；接了线只转发载荷（toggle 少了布尔就拒）', async () => {
  const session = { projectRoot: null, registry: null, runtime: null, view: null }
  const bare = createIpcDispatcher({ session })
  for (const channel of [IPC_CHANNELS.skillsList, IPC_CHANNELS.skillsToggle, IPC_CHANNELS.skillsBody, IPC_CHANNELS.skillsImport]) {
    const result = await bare.dispatch(channel, {})
    assert.equal(result.ok, false)
    assert.match(result.error.message, /技能服务未接入/u)
  }

  const seen = []
  const service = {
    async list() { seen.push(['list']); return { ok: true, value: { rows: [] } } },
    async toggle(name, enabled) { seen.push(['toggle', name, enabled]); return { ok: true, value: { name, enabled } } },
    async body(name) { seen.push(['body', name]); return { ok: true, value: { name, body: BODY } } },
    async importFrom(sourceDir) { seen.push(['import', sourceDir]); return { ok: true, value: { imported: [], rejected: [] } } }
  }
  const wired = createIpcDispatcher({ session, skillsService: service })
  assert.equal((await wired.dispatch(IPC_CHANNELS.skillsList, {})).ok, true)
  const toggled = await wired.dispatch(IPC_CHANNELS.skillsToggle, { name: 'alpha', enabled: false })
  assert.equal(toggled.ok, true)
  assert.deepEqual(seen.at(-1), ['toggle', 'alpha', false])
  const missingFlag = await wired.dispatch(IPC_CHANNELS.skillsToggle, { name: 'alpha' })
  assert.equal(missingFlag.ok, false)
  assert.match(missingFlag.error.message, /要给出 enabled/u)
  assert.equal((await wired.dispatch(IPC_CHANNELS.skillsBody, { name: 'alpha' })).value.body, BODY)
  assert.equal((await wired.dispatch(IPC_CHANNELS.skillsImport, { sourceDir: 'C:/x' })).ok, true)
  assert.deepEqual(seen.at(-1), ['import', 'C:/x'])
})
