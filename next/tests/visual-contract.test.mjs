import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * Next 外壳的视觉一致性门禁。
 *
 * 作者的口径是「在原本的前端审美一致性上添加功能，包括按钮和风格的复用」——
 * 这条门禁就是那句话的机器版本：
 *   1. Next 自己写的样式里不许出现硬编码颜色（一律走老前端的 token）；
 *   2. Next 用到的每个 token 都必须在老前端那几份 CSS 或 Next 自己的布局层里有定义
 *      （防止 var(--x) 写错名字后静默失效）；
 *   3. Next 不许另立一套配色——除了自己的 --nx-* 布局变量，不许重新定义任何老 token；
 *   4. 每个 <button> 都得落在共享词汇里（原版 .control-*、行按钮 .nx-row、
 *      老版导航行 .workspace-nav-item、老版竖条 .nx-ribbon-item）；
 *   5. 风格层引的是老前端 CSS 的本体（不是拷贝），文件得真的在；
 *   6. 外壳根节点挂着 theme-legacy（颜色与控件词汇都靠这个 class 生效）；
 *   7. 选中色分级全部来自老版原件——Next 一个公式都不许重定义；
 *   8. 竖条的度量必须是老前端那份数字，抄歪了门禁就红。
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const shellDir = join(repoRoot, 'next', 'shell')

/**
 * Next 外壳引用的老前端样式层。
 * 后两份是老前端工作区的 chrome（AppShell.vue:20-21 引的就是这两份）：
 * 导航行词汇与两级选中色都住在里面，Next 外壳的根节点挂 .app-shell 就能拿到。
 */
const LEGACY_CSS = [
  join(repoRoot, 'src', 'styles', 'main.css'),
  join(repoRoot, 'src', 'styles', 'themes', 'legacy.css'),
  join(repoRoot, 'src', 'styles', 'workbench-controls.css'),
  join(repoRoot, 'src', 'styles', 'workspace-navigation.css'),
  join(repoRoot, 'src', 'styles', 'workspace-surfaces.css')
]

/**
 * 按钮的共享词汇。每一类都对应老前端已经存在的一套控件：
 *   control-*        → 老版命令按钮（workbench-controls.css）
 *   nx-row           → Next 自己的行按钮 primitive（度量沿用老版侧栏行）
 *   workspace-nav-item → 老版侧栏导航行（workspace-navigation.css:21-75）
 *   nx-ribbon-item   → 老版图标竖条按钮（WorkspaceContentGroups.vue:190-196 的镜像）
 *   authoring-knowledge__* → 老版作品资料助手的会话控件
 *     （AuthoringKnowledgeAssistant.vue，Next 右栏的对话框整块抽自它）
 */
const SHARED_BUTTON_CLASSES = ['control-', 'nx-row', 'workspace-nav-item', 'nx-ribbon-item', 'authoring-knowledge__']

/** 允许出现的颜色关键字：这三个不是「写死的颜色」。 */
const COLOR_ALLOWED = new Set(['transparent', 'currentcolor', 'inherit'])

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g
const FUNC_COLOR = /\b(?:rgba?|hsla?)\s*\(/g
const NAMED_COLOR = /(?<![-\w])(?:white|black|red|blue|green|gray|grey|silver|gold|orange|purple|yellow|pink|cyan|magenta|brown|navy|teal|maroon|olive|lime|aqua|fuchsia)(?![-\w])/g

async function exists(path) {
  return stat(path).then(() => true, () => false)
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else out.push(full)
  }
  return out
}

/** Next 自己写的样式：布局层 CSS + 各 SFC 里的 <style> 块。 */
async function authoredStyleSources() {
  const sources = []
  const files = await walk(shellDir)
  for (const file of files) {
    if (file.endsWith('.css')) {
      sources.push({ path: file, text: await readFile(file, 'utf-8') })
      continue
    }
    if (!file.endsWith('.vue')) continue
    const text = await readFile(file, 'utf-8')
    for (const match of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      sources.push({ path: file, text: match[1] })
    }
  }
  return sources
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

test('Next 外壳的样式里没有硬编码颜色：一律走老前端的 token', async () => {
  const sources = await authoredStyleSources()
  assert.ok(sources.length > 0, '没找到 Next 自己写的样式，扫描面空了等于没测')
  const offenders = []
  for (const source of sources) {
    const css = stripComments(source.text)
    for (const pattern of [HEX_COLOR, FUNC_COLOR]) {
      pattern.lastIndex = 0
      for (const match of css.matchAll(pattern)) offenders.push(`${source.path}: ${match[0]}`)
    }
    NAMED_COLOR.lastIndex = 0
    for (const match of css.matchAll(NAMED_COLOR)) {
      if (COLOR_ALLOWED.has(match[0].toLowerCase())) continue
      offenders.push(`${source.path}: ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], `Next 外壳出现硬编码颜色：\n${offenders.join('\n')}`)
})

test('Next 用到的每个 token 都有定义（var(--x) 写错名字会静默失效）', async () => {
  const defined = new Set()
  for (const file of [...LEGACY_CSS, join(shellDir, 'styles', 'next-shell.css')]) {
    const text = await readFile(file, 'utf-8')
    for (const match of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(match[1])
  }
  const sources = await authoredStyleSources()
  const missing = new Set()
  for (const source of sources) {
    for (const match of stripComments(source.text).matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,|\))/g)) {
      if (match[2] === ',') continue
      if (!defined.has(match[1])) missing.add(`${source.path}: ${match[1]}`)
    }
  }
  assert.deepEqual([...missing], [], `用到了没有定义的 token：\n${[...missing].join('\n')}`)
})

test('Next 不许另立一套配色：除了 --nx-* 布局变量，不许重新定义老 token', async () => {
  const layout = await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8')
  const redefined = []
  for (const match of stripComments(layout).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
    if (match[1].startsWith('--nx-')) continue
    redefined.push(match[1])
  }
  assert.deepEqual(redefined, [], `Next 布局层重新定义了老前端的 token：${redefined.join(' ')}`)
})

test('每个按钮都落在共享词汇里：老版控件／行按钮／老版导航行／老版竖条', async () => {
  const files = (await walk(shellDir)).filter((file) => file.endsWith('.vue'))
  const offenders = []
  for (const file of files) {
    const text = await readFile(file, 'utf-8')
    for (const match of text.matchAll(/<button\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
      const tag = match[0]
      const classAttr = tag.match(/class="([^"]*)"/)
      const classes = classAttr ? classAttr[1].split(/\s+/) : []
      const shared = classes.some((name) => SHARED_BUTTON_CLASSES.some((prefix) => name === prefix || name.startsWith(prefix)))
      if (!shared) offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  }
  assert.deepEqual(offenders, [], `这些按钮没进共享控件词汇：\n${offenders.join('\n')}`)
})

test('风格层引的是老前端 CSS 本体：文件在、有内容、Next 没自带副本', async () => {
  const legacyPath = join(shellDir, 'styles', 'legacy.mjs')
  const legacyModule = await readFile(legacyPath, 'utf-8')
  const stylesDir = join(shellDir, 'styles')
  const imported = [...legacyModule.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  const resolved = imported.map((specifier) => resolve(stylesDir, specifier))
  for (const file of LEGACY_CSS) {
    assert.equal(await exists(file), true, `老前端样式层缺文件：${file}`)
    const text = await readFile(file, 'utf-8')
    assert.ok(text.length > 500, `老前端样式层文件像是空的：${file}`)
    assert.ok(resolved.includes(file), `legacy.mjs 没有引老前端样式：${file}`)
  }
  assert.ok(resolved.includes(join(stylesDir, 'next-shell.css')), 'Next 自己的布局层也要引进来')
  // 拷贝一份 CSS 进来就等于另立一套视觉系统：Next 的样式目录里只该有自己的布局层。
  const cssFiles = (await walk(stylesDir)).filter((file) => file.endsWith('.css'))
  assert.deepEqual(cssFiles.map((file) => file.replace(/\\/g, '/')), [join(stylesDir, 'next-shell.css').replace(/\\/g, '/')], 'next/shell/styles 下出现了老前端 CSS 的拷贝')
})

test('外壳根节点挂着 theme-legacy：颜色与控件词汇都靠这个 class 生效', async () => {
  const html = await readFile(join(shellDir, 'index.html'), 'utf-8')
  assert.match(html, /<html[^>]*class="[^"]*theme-legacy/, 'next/shell/index.html 的 html 根必须带 theme-legacy')
  const renderer = await readFile(join(shellDir, 'renderer.mjs'), 'utf-8')
  assert.match(renderer, /styles\/legacy\.mjs/, '渲染层入口必须引老前端样式层')
})

/** 取一条规则的花括号内容。 */
function ruleBody(css, selector) {
  const index = css.indexOf(selector)
  if (index < 0) return null
  const open = css.indexOf('{', index)
  const close = css.indexOf('}', open)
  return open < 0 || close < 0 ? null : css.slice(open + 1, close)
}

test('外壳根节点挂着 app-shell：老版那两段 token 与行规则靠它生效', async () => {
  const app = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')
  assert.match(app, /class="next-shell app-shell"/, 'Next 外壳根节点必须同时挂 .app-shell，老版的 --nav-* 与 .workspace-nav-item 规则都靠它生效')
})

test('右栏是一个纯粹的对话框：形态抽自老版助手，开发者向的备注不许留在面上', async () => {
  const dialog = await readFile(join(shellDir, 'AssistantDialog.vue'), 'utf-8')
  const legacy = await readFile(join(repoRoot, 'src', 'components', 'authoring', 'AuthoringKnowledgeAssistant.vue'), 'utf-8')

  // 形态必须是老版那套会话词汇，不是新造的：抽象不是重写。
  for (const needle of [
    'authoring-knowledge__thread',
    'authoring-knowledge__question-row',
    'authoring-knowledge__answer',
    'authoring-knowledge__answer-text',
    'authoring-knowledge__composer',
    'authoring-knowledge__input-row',
    'authoring-knowledge__send'
  ]) {
    assert.ok(legacy.includes(needle), `老前端助手里没有 ${needle}，抽象的基准没了`)
    assert.ok(dialog.includes(needle), `对话框没有用老版的会话词汇：${needle}`)
  }

  // 运行时栏上不许再摆开发者向的说明文字（预算、占位权、写族闸、接管数）。
  const dock = await readFile(join(shellDir, 'RuntimeDock.vue'), 'utf-8')
  for (const needle of ['预算优先级', '不可停用', '一级公民', '写族闸', '载体接管', 'reservedSlotReason', 'budgetPriority', 'writeGuard']) {
    assert.ok(!dock.includes(needle), `右栏还留着开发者向的备注：${needle}`)
  }
})

test('主页面上不许摆无效模块：骨架目录、板块声明、保存口径都不在正文面板上', async () => {
  const index = await readFile(join(shellDir, 'IndexWindow.vue'), 'utf-8')
  assert.ok(!index.includes('固化骨架'), '索引窗不该再列固化骨架目录')
  assert.ok(!index.includes('skeletonDirs'), '索引窗不该再收骨架目录这份数据')

  const pane = await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')
  assert.ok(!pane.includes('板块声明'), '正文面板不该再摆「板块声明」清单')
  assert.ok(!pane.includes('editor-note'), '正文面板不该再摆保存口径的脚注')
})

test('载体面板 P2/P3（协议 §1）：头部统一进 .doc-head，保存按钮不许带版本号', async () => {
  // P3 文案门禁（协议 §6.1）：版本号不进按钮文案——版本在文档底部 hint 与历史面板看。
  for (const file of ['CarrierPaneHost.vue', 'AppNext.vue']) {
    const source = await readFile(join(shellDir, file), 'utf-8')
    assert.ok(!source.includes('保存为第'), `${file} 出现「保存为第」：保存按钮统一叫「保存」（P3）`)
    assert.ok(!source.includes('保存为新版本'), `${file} 出现「保存为新版本」：保存按钮统一叫「保存」（P3）`)
  }

  // P2 落地抽查：每个视图的头部是一个 .doc-head 容器
  // （chapter／notes／outline／entry(+rule)／proposal，资料面同样归入）。
  const pane = await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')
  const headers = (pane.match(/class="doc-head"/g) ?? []).length
  assert.ok(headers >= 5, `.doc-head 只落了 ${headers} 处：五个视图的头部都要归一进这个容器`)
  const titles = (pane.match(/class="doc-title[ "]/g) ?? []).length
  assert.ok(titles >= 5, `.doc-title 只找到 ${titles} 处：每个视图头部都要有一行标题（P2）`)
})

test('选中色分级全部来自老版原件：Next 不许抄一份公式', async () => {
  const layout = await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8')
  const nav = await readFile(join(repoRoot, 'src', 'styles', 'workspace-navigation.css'), 'utf-8')

  // 老版的公式在原件里（workspace-navigation.css:7-10）；Next 一个字都不许重定义。
  assert.match(nav, /--nav-surface:\s*var\(--surface-workbench-muted\)/, '老版导航底色就是 muted 面')
  assert.match(nav, /--nav-hover:\s*color-mix\(in srgb, var\(--archive-ink\) 5%, var\(--nav-surface\)\)/, '老版 hover 是 5% 墨色叠导航面')
  assert.match(nav, /--nav-selected:\s*color-mix\(in srgb, var\(--archive-ink\) 7%, var\(--nav-surface\)\)/, '老版次级选中是 7% 墨色叠导航面')
  assert.match(nav, /--nav-selected-secondary:\s*color-mix\(in srgb, var\(--archive-ink\) 5%, var\(--nav-surface\)\)/, '老版导航行的选中是 5% 墨色叠导航面')
  assert.match(nav, /--nav-primary-selected:\s*var\(--workbench-selected\)/, '老版的当前板就是强选中色')

  const copied = [...stripComments(layout).matchAll(/(--nav-[a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1])
  assert.deepEqual(copied, [], `Next 抄了老版的选中色公式：${copied.join(' ')}`)

  // 竖条的当前板走老版的强选中（--nav-primary-selected 就是 --workbench-selected）。
  const ribbon = ruleBody(layout, '.nx-ribbon-item.is-active')
  assert.ok(ribbon, 'next-shell.css 里没有 .nx-ribbon-item.is-active 规则')
  assert.match(ribbon, /background:\s*var\(--nav-primary-selected\)/, '竖条的当前项应走老版的强选中色')
  assert.match(ruleBody(layout, '.nx-ribbon-item:hover'), /var\(--nav-hover\)/, '竖条的悬停应走老版的 hover 色')

  // 索引窗的行不写自己的选中色：它用老版的 .workspace-nav-item 词汇，选中色由原件那份 CSS 给。
  const index = await readFile(join(shellDir, 'IndexWindow.vue'), 'utf-8')
  assert.match(index, /class="workspace-nav-item workspace-nav-item--tree nx-tree-row[ "]/, '索引窗的行必须用老版的 .workspace-nav-item 词汇')
})

test('图标竖条的度量抄的是老前端那份：两个文件里的数字必须一致', async () => {
  const legacy = await readFile(join(repoRoot, 'src', 'components', 'workbench', 'WorkspaceContentGroups.vue'), 'utf-8')
  const layout = await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8')
  // 老版那几条规则在 SFC 的 scoped 样式里，scoped 没法 import，所以 Next 抄了一份——数字必须一样。
  for (const needle of ['flex: 0 0 44px', 'width: 44px', 'height: 46px', 'padding-top: 4px', 'margin-bottom: 8px']) {
    assert.ok(legacy.includes(needle), `老前端竖条里没有 ${needle}，Next 抄的基准没了`)
    assert.ok(layout.includes(needle), `next-shell.css 的竖条少了 ${needle}`)
  }
})

/**
 * 字号/圆角刻度门禁（批次 7 起）。老前端只 token 化了 --fs-sm(12)/--fs-base(14) 与
 * 三档 --radius-*，Next 把中间档收进 --nx-fs-* 与 --nx-radius-xs（定义在 next-shell.css）。
 * 从此 Next 自己写的样式不许再出现裸 px 字号/圆角——写裸值就是又飘出一档刻度。
 * 例外：注释里带 legacy-copied 的样式块（逐条抄老版度量的复用件，如 AssistantDialog 的会话形态）。
 */
test('字号与圆角一律走刻度 token：Next 自写样式不许再出现裸 px', async () => {
  const sources = await authoredStyleSources()
  const offenders = []
  for (const source of sources) {
    if (source.text.includes('legacy-copied')) continue
    const css = stripComments(source.text)
    for (const match of css.matchAll(/(?:font-size|border-radius)\s*:\s*\d+(?:\.\d+)?px/g)) {
      offenders.push(`${source.path}: ${match[0]}`)
    }
    for (const match of css.matchAll(/\bfont\s*:\s*[^;}]*\b\d+(?:\.\d+)?px/g)) {
      offenders.push(`${source.path}: ${match[0].trim().slice(0, 60)}`)
    }
  }
  assert.deepEqual(offenders, [], `Next 自写样式出现裸 px 字号/圆角（应收进 --nx-* 刻度或 --fs-*/--radius-*）：\n${offenders.join('\n')}`)
})

test('刻度 token 必须真的定义在布局层：--nx-fs-* 与 --nx-radius-xs 缺一条，var() 就静默失效', async () => {
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  for (const token of ['--nx-fs-2xs', '--nx-fs-md', '--nx-fs-lg', '--nx-fs-xl', '--nx-fs-2xl', '--nx-radius-xs']) {
    assert.match(layout, new RegExp(`${token.replace(/-/g, '\\-')}\\s*:`), `next-shell.css 缺刻度 token ${token}`)
  }
})

/**
 * 核心区弹窗化门禁（工单B0 · 作者裁定 U13）：
 * 「对于所有的配置项，设置页，以及顶栏延伸下来的功能配置页面，都用圆润的弹窗做统一的处理，
 *  不在核心工作区强插入任何按钮，核心工作区是纯净的文档和组件展示。」
 * 这条门禁就是那句话的机器版本：
 *   1. AppNext 的核心区不得再内嵌 class="wizard" 的配置 section
 *      （内层布局类如 prefs-grid／wizard-note 可以留在弹窗里继续用）；
 *   2. WorkbenchModal 存在，且形态词汇是老前端那三枚 token——圆角 --radius-surface、
 *      遮罩 --surface-overlay、层级 --z-modal-backdrop，不自造一套弹窗皮。
 */
test('核心区弹窗化：配置一律进 WorkbenchModal，核心区不再内嵌 wizard section', async () => {
  const app = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')
  assert.ok(!app.includes('class="wizard"'), 'AppNext 核心区不得再内嵌 class="wizard" 的配置 section（U13：核心区只留文档与组件展示）')

  const modalPath = join(shellDir, 'WorkbenchModal.vue')
  assert.equal(await exists(modalPath), true, 'next/shell/WorkbenchModal.vue 必须存在（弹窗统一走这一枚原语）')
  const modal = await readFile(modalPath, 'utf-8')
  for (const token of ['--radius-surface', '--surface-overlay', '--z-modal-backdrop']) {
    assert.ok(modal.includes(token), `WorkbenchModal 必须用老前端 token ${token}，不许自造弹窗形态`)
  }
})

/**
 * 弹窗归一化门禁（工单C0 · U13 的续）：弹窗是统一的二级页面——左栏设置分区目录＋右栏设置项面板，
 * 「任何功能弹窗必须登记进统一目录，目录外弹窗不允许存在」落成两条 grep：
 *   1. WorkbenchModal 在 next/shell 里只允许被 SettingsModal.vue 挂载（底座不许被绕开）；
 *   2. SettingsModal 存在，且目录词汇照抄老版设置弹窗
 *      （settings-navigation／settings-tab／settings-section、tablist／tabpanel 角色）。
 */
test('目录外弹窗不允许存在：WorkbenchModal 只允许被 SettingsModal 挂载', async () => {
  const offenders = []
  for (const file of (await walk(shellDir)).filter((candidate) => candidate.endsWith('.vue'))) {
    if (file.endsWith('WorkbenchModal.vue') || file.endsWith('SettingsModal.vue')) continue
    const text = await readFile(file, 'utf-8')
    if (text.includes('WorkbenchModal')) offenders.push(file)
  }
  assert.deepEqual(offenders, [], `WorkbenchModal 只能被 SettingsModal 挂载（U13：目录外弹窗不允许存在），越界文件：\n${offenders.join('\n')}`)
})

test('统一设置二级页：SettingsModal 存在且用老版设置弹窗的目录词汇', async () => {
  const settingsPath = join(shellDir, 'SettingsModal.vue')
  assert.equal(await exists(settingsPath), true, 'next/shell/SettingsModal.vue 必须存在（统一二级页：左栏目录＋右栏设置项）')
  const settings = await readFile(settingsPath, 'utf-8')
  for (const needle of ['settings-navigation', 'settings-tab', 'settings-section', 'role="tablist"', 'role="tabpanel"', 'WorkbenchModal']) {
    assert.ok(settings.includes(needle), `SettingsModal 缺老版设置弹窗的目录词汇：${needle}`)
  }
  // D2：目录分两组（设置／文档），文档历史节登记在「文档」组里。
  assert.ok(settings.includes('settings-group-label'), 'SettingsModal 缺分组标题（设置／文档）的目录词汇')
})

/**
 * R3-1／D2：主题的权威来源迁到偏好 JSON，next/shell 源码不得再出现 localStorage。
 * 例外只有三处，都有明确边界：
 *   1) theme.mjs 里带 legacy-localstorage-bridge 标记的过渡双写块（老前端退役后删）；
 *   2) sessionMigration.mjs 的老会话迁移（M2.5-B 工单 §3）——
 *      只读老键 `agentSessions.<projectRoot>`、写盘成功后 removeItem；**不许 setItem**；
 *   3) workspaceMigration.mjs 的老工作区迁移（M2.5-C 工单 §1）——
 *      只读老键 `paneForm.<paneId>` / `overlay.<paneId>`，搬进 .pinax/workspace.json 成功后 removeItem；
 *      **不许 setItem**。迁移跑完老键就没了，这块例外随之一并退役；
 *   4) entriesView.mjs 的世界书视图记忆（批次28 工单3 明确要求）——
 *      只许用 `entriesView.<projectRoot>` 这一条键，键名由本模块拼（换项目＝各记各的视图）。
 * FloatingWidget／paneForms 的 localStorage 记忆已在 M2.5-C 删掉：位置与形态的真相在 workspace.json。
 * 这个例外是会退役的：双写块删掉后为 0 处访问，断言仍通过；其它文件一旦出现 localStorage 立刻红。
 */
test('next/shell 源码不得出现 localStorage（例外只有 theme 过渡双写、会话迁移、工作区迁移与条目视图记忆）', async () => {
  const files = (await walk(shellDir)).filter((file) => /\.(mjs|js|vue|html)$/u.test(file))
  const offenders = []
  for (const file of files) {
    if (file.endsWith('theme.mjs')) continue
    // 注释里提到这个词不算使用（theme 迁移的说明文字要能写清楚）；只看去掉注释后的源码。
    const text = stripComments(await readFile(file, 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
    if (file.endsWith('sessionMigration.mjs')) {
      // 老会话迁移（M2.5-B）：只读老键、成功后删；不许写（新会话的真相在 .pinax/sessions/）。
      assert.match(text, /export function legacyLocalStorage/u,
        '迁移模块必须把 localStorage 访问收在 legacyLocalStorage 一个函数里')
      const accesses = text.match(/[^\n]*\.localStorage[^\n]*/gu) ?? []
      assert.ok(accesses.length > 0, '迁移模块负责读老键')
      for (const line of accesses) {
        assert.match(line, /globalThis\.localStorage/u, `localStorage 访问必须走 globalThis.localStorage（沙箱里可能抛）：${line.trim()}`)
      }
      assert.doesNotMatch(text, /\.setItem\s*\(/u, '迁移只读不写：会话不再写 localStorage')
      continue
    }
    if (file.endsWith('workspaceMigration.mjs')) {
      // 老工作区迁移（M2.5-C）：只读 paneForm.<paneId> / overlay.<paneId>，成功后删；
      // 新真相在 .pinax/workspace.json，迁移之后 localStorage 不再是任何位置数据的来源。
      assert.match(text, /export function legacyLocalStorage/u,
        '工作区迁移必须把 localStorage 访问收在 legacyLocalStorage 一个函数里')
      assert.match(text, /LEGACY_PANE_FORM_PREFIX = 'paneForm\.'/u, '迁移要读老键 paneForm.(paneId)')
      assert.match(text, /LEGACY_OVERLAY_PREFIX = 'overlay\.'/u, '迁移要读老键 overlay.(paneId)')
      const accesses = text.match(/[^\n]*\.localStorage[^\n]*/gu) ?? []
      assert.ok(accesses.length > 0, '迁移模块负责读老键')
      for (const line of accesses) {
        assert.match(line, /globalThis\.localStorage/u, `localStorage 访问必须走 globalThis.localStorage（沙箱里可能抛）：${line.trim()}`)
      }
      assert.doesNotMatch(text, /\.setItem\s*\(/u, '迁移只读不写：位置与形态不再写 localStorage')
      continue
    }
    if (file.endsWith('entriesView.mjs')) {
      // 世界书视图记忆（批次28 · 工单3）：键必须是 entriesView.<projectRoot>，且由本模块拼。
      assert.match(text, /ENTRIES_VIEW_STORAGE_PREFIX = 'entriesView\.'/u,
        '视图记忆的键前缀必须是 entriesView.（键名带项目根）')
      assert.match(text, /`\$\{ENTRIES_VIEW_STORAGE_PREFIX\}\$\{/u,
        '视图记忆的键必须由前缀 + 项目根拼出')
      const accesses = text.match(/[^\n]*\.localStorage[^\n]*/gu) ?? []
      assert.ok(accesses.length > 0, 'entriesView 应负责视图记忆的读写')
      for (const line of accesses) {
        assert.match(line, /storage/iu, `localStorage 访问必须经 storage 抽象（键 entriesView.<projectRoot>）：${line.trim()}`)
      }
      continue
    }
    if (text.includes('localStorage')) offenders.push(file)
  }
  assert.deepEqual(offenders, [], `除了 theme.mjs 的过渡双写块、sessionMigration 的老会话迁移、workspaceMigration 的老工作区迁移与 entriesView 的视图记忆，next/shell 源码不得出现 localStorage：\n${offenders.join('\n')}`)

  const theme = await readFile(join(shellDir, 'theme.mjs'), 'utf-8')
  const accesses = (theme.match(/\.localStorage/g) ?? []).length
  assert.ok(accesses <= 1, `过渡期只允许「只写不读」的一处 localStorage 访问（读会造出第二个真相源），实际 ${accesses} 处`)
  if (accesses > 0) {
    assert.match(theme, /legacy-localstorage-bridge/, 'theme.mjs 的过渡双写块必须带 legacy-localstorage-bridge 标记')
    assert.match(theme, /老前端退役后删/, '过渡双写块必须写明老前端退役后删除')
    assert.doesNotMatch(stripComments(theme), /\.localStorage\??\.getItem/u, '禁止读浏览器缓存：权威来源只能是偏好 JSON')
  }
})

/**
 * 协议 v1.1-C（工单C）→ M2.5-C：悬浮小工具窗＝宿主容器＋载体声明。
 * 三条边界都可机读：
 *   1) FloatingWidget 是唯一宿主——拖动句柄、Esc、位置回传（emit geometry）都在它身上；
 *      位置与最小化的真相在 workspace 四轴（.pinax/workspace.json），组件自己不落盘；
 *   2) AppNext 只接线开合与内容，不许维护悬浮窗的硬编码坐标表（位置归宿主）；
 *   3) outline manifest 声明 overlay pane，层序 token 必须低于统一二级页。
 */
test('协议 v1.1-C：FloatingWidget 是悬浮窗宿主容器（拖动／气泡／几何回传／Esc 都在宿主）', async () => {
  const widgetPath = join(shellDir, 'FloatingWidget.vue')
  assert.equal(await exists(widgetPath), true, 'next/shell/FloatingWidget.vue 必须存在（悬浮窗宿主容器）')
  const widget = await readFile(widgetPath, 'utf-8')
  for (const needle of [
    'startDrag',
    'pointerdown',
    'Escape',
    "emit('close')",
    "emit('toggle')",
    "emit('bubble')",
    "emit('restore')",
    "emit('geometry',",
    'getBoundingClientRect',
    'data-overlay-instance',
    'props.geometry'
  ]) {
    assert.ok(widget.includes(needle), `FloatingWidget 缺宿主职责：${needle}`)
  }
  assert.ok(widget.includes('nx-overlay-tab'), '收起态要有侧缘小标签（点击展开）')
  assert.ok(widget.includes('nx-overlay-bubble'), '气泡态要有气泡球（点击展开）')
  assert.ok(widget.includes('<slot />'), '内容经插槽由外壳注入，宿主不自造载体内容')
})

test('协议 v1.1-C：载体 SFC 不许自带拖拽／定位逻辑（P16：宿主管渲染）', async () => {
  const carriersDir = join(repoRoot, 'next', 'carriers')
  // 今天 next/carriers/ 里还没有 SFC（载体工具/清单都是 .mjs）；这条断言是给后续载体声明
  // overlay pane 时立的钉子——谁把拖拽/定位写进载体 SFC，这里直接红。
  const carrierSfcs = (await walk(carriersDir)).filter((file) => file.endsWith('.vue'))
  const offenders = []
  for (const file of carrierSfcs) {
    const text = stripComments(await readFile(file, 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
    for (const needle of ['pointerdown', 'mousedown', 'localStorage', 'getBoundingClientRect', 'position: absolute', 'position:absolute']) {
      if (text.includes(needle)) offenders.push(`${file}: ${needle}`)
    }
  }
  assert.deepEqual(offenders, [], `载体 SFC 不许自带拖拽/定位（宿主 FloatingWidget 负责）：\n${offenders.join('\n')}`)
})

test('协议 v1.1-C：AppNext 不含悬浮窗硬编码坐标表；位置记忆键 overlay.<paneId> 只在宿主里拼', async () => {
  const app = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')
  assert.ok(app.includes('<FloatingWidget'), '外壳要挂宿主容器')
  assert.ok(app.includes(':id="pane.paneId"'), '宿主按 paneId 区分实例（位置记忆键 overlay.<paneId>）')
  assert.doesNotMatch(app, /\boverlay[_-]?positions?\b/iu, 'AppNext 不许维护 overlay 的硬编码坐标表')
  assert.doesNotMatch(app, /(?:left|top|right)\s*:\s*['"]?\d+px/u, 'AppNext 不许写悬浮窗的硬编码坐标（定位归 FloatingWidget）')
  assert.doesNotMatch(app, /\.localStorage/u, '位置记忆归宿主 FloatingWidget，AppNext 不碰 localStorage')
})

test('协议 v1.1-C：outline manifest 声明 overlay pane；层序高于编辑器、低于统一二级页', async () => {
  const manifest = await readFile(join(repoRoot, 'next', 'carriers', 'outline', 'manifest.mjs'), 'utf-8')
  assert.match(manifest, /slot: 'overlay'/u, '大纲载体要声明 overlay pane')
  assert.match(manifest, /id: 'outline\.widget'/u, 'overlay pane id 固定 outline.widget')
  const layout = await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8')
  const rule = ruleBody(layout, '.nx-overlay-widget')
  assert.ok(rule, 'next-shell.css 里没有 .nx-overlay-widget 规则')
  assert.match(rule, /position:\s*absolute/u, '悬浮窗是 absolute 定位卡片')
  assert.match(rule, /z-index:\s*var\(--z-floating-dock\)/u, '层序走 --z-floating-dock（高于编辑器、低于统一二级页）')
  const tokens = await readFile(join(repoRoot, 'src', 'styles', 'main.css'), 'utf-8')
  const overlayZ = Number(/--z-floating-dock:\s*(\d+)/u.exec(tokens)?.[1])
  const modalZ = Number(/--z-modal:\s*(\d+)/u.exec(tokens)?.[1])
  assert.ok(Number.isFinite(overlayZ) && Number.isFinite(modalZ) && overlayZ < modalZ, `悬浮层 z(${overlayZ}) 必须低于统一二级页 z(${modalZ})`)
})

/**
 * P18 文档为主合同（批次31，作者 2026-10-29）：
 * 「我们是一个面向 Obsidian 的 doc 类组件，应该是以文档为主。就算有按钮，也应该在文档的
 *  一些不显眼的位置去展示。」
 *
 * 合同落实成四条机器钉子：
 *   1) 编辑面＝文档本身：.editor-area 的规则块里没有描边／圆角，底色透明（只留 padding 呼吸）；
 *   2) 常驻按钮行一律取消：CarrierPaneHost 里 control-primary 出现 0 次
 *      （大纲／条目／提案三处旧主按钮拆净，保存只剩 Ctrl+S＋chip）；
 *   3) 控件三分之一「按需浮现」：大纲节点操作只在索引窗树行右键菜单里
 *      （outline-move／outline-remove／outline-add 这些常驻选择器从编辑面消失）；
 *   4) 元数据默认折叠：条目信息层是 v-if（收起时字段不在 DOM），不是 v-show。
 * 面板型界面（提案的两版对照）不受此约束，但它的动作行也不许再长回主按钮皮。
 */
test('P18 文档为主：正文去框、常驻保存按钮拆净、节点操作只在右键菜单、条目信息默认折叠', async () => {
  const pane = await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')

  // ① 正文满幅：.editor-area 规则块里没有 border:／border-radius:，底色透明。
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  const area = ruleBody(layout, '.editor-area {')
  assert.ok(area, 'next-shell.css 里没有 .editor-area 规则')
  assert.doesNotMatch(area, /border\s*:/u, '.editor-area 又画了描边：编辑面就是文档本身，不许「中间一个框把内容装进去」')
  assert.doesNotMatch(area, /border-radius\s*:/u, '.editor-area 又上了圆角：文档不是卡片')
  assert.match(area, /background:\s*transparent/u, '.editor-area 的底色应透明（铺在窗格底色上）')
  assert.match(area, /padding:/u, '.editor-area 要留呼吸留白（padding 不算框）')

  // ①b 焦点环显式关掉：写作面的焦点指示就是光标。不写 none，Chrome 的 :focus-visible
  //    默认环会顶上来，而且它取 Windows 系统强调色（作者的橙色「黄框」就是这么来的）。
  const focusRule = ruleBody(layout, '.editor-area:focus-visible {')
  assert.ok(focusRule, '.editor-area:focus-visible 规则丢了：写作面会顶出 UA 默认焦点环（取系统强调色）')
  assert.match(focusRule, /outline:\s*none/u, '.editor-area:focus-visible 必须 outline:none（显式关掉 UA 默认环）')

  // ② 常驻按钮行取消：模板里一个主按钮都不要（注释里也不许留这个词，免得断言含糊）。
  const primaries = pane.match(/control-primary/gu) ?? []
  assert.equal(primaries.length, 0, `CarrierPaneHost 还留着 ${primaries.length} 处常驻主按钮（P18 第 3 条：保存只有 Ctrl+S＋chip）`)
  assert.ok(!pane.includes('.editor-foot .control-primary'), '编辑面不该再有底部按钮行里的保存键')

  // ③ 大纲：节点操作退到索引窗右键菜单，编辑面只剩无框标题＋无框备注。
  for (const gone of ['outline-move', 'outline-remove', 'outline-add']) {
    assert.ok(!pane.includes(gone), `大纲编辑面还留着常驻节点操作选择器：${gone}（应只在树行右键菜单里）`)
  }
  assert.match(pane, /class="doc-title outline-title"/u, '大纲节点标题要用 .doc-title（无边框大字）')
  assert.match(pane, /class="doc-field outline-note"/u, '大纲节点备注要用 .doc-field（标题下的无框第二行）')
  assert.match(layout, /\.doc-title[\s\S]{0,400}?font-size:\s*var\(--nx-fs-xl\)/u, '.doc-title 字号要升一档（走 --nx-fs-* 刻度）')

  const index = await readFile(join(shellDir, 'IndexWindow.vue'), 'utf-8')
  for (const key of [
    'outline-node-move-up',
    'outline-node-move-down',
    'outline-node-remove',
    'outline-node-add-sibling',
    'outline-node-add-child'
  ]) {
    assert.match(index, new RegExp(`data-test="${key}"`, 'u'), `大纲树行右键菜单缺 ${key}（P18 第 2 条：节点操作按需浮现）`)
  }
  // 复用批次24 打开方式菜单的同一套词汇，不另起一套菜单皮。
  assert.match(index, /class="nx-context-menu"/u, '节点菜单要用宿主那套 .nx-context-menu 词汇')
  assert.match(index, /class="control-quiet nx-context-item/u, '节点菜单条目要走老版控件词汇（control-quiet／nx-context-item）')

  // ④ 条目信息默认折叠：字段容器挂在 entryMetaOpen 上（v-if＝收起时不在 DOM）。
  assert.match(pane, /data-test="entry-meta-toggle"/u, '编辑面要有一行「条目信息」开关')
  assert.match(pane, /v-if="entryMetaOpen"[^>]*class="entry-meta-edit"/u, '条目字段容器必须是 v-if="entryMetaOpen"（默认折叠，不是 v-show）')
  assert.doesNotMatch(pane, /v-show="entryMetaOpen"/u, '折叠层不许用 v-show 假装折叠（字段仍在 DOM 里）')
})

/**
 * 批次33（作者 2026-10-30）：「作为一个 doc 来说，就是标题栏放一个标题，其他东西就不用放了，
 * 最多在底部放一些提示。」「左侧部分：正常的 IDE 是怎么设计的，你就怎么设计呗。」
 *
 * 两条合同落到机器门口：
 *   A. 文档头归一：头部只有一行 .doc-title，meta 沉到正文之下的 .doc-meta-hint；
 *      双层头（pane-sub 标题＋身份／项目名那一层）不在场；.editor-area 不再套聚焦蓝框。
 *   B. 索引窗 IDE 化：行＝名字（没有「1. 」数字前缀）、版本／字数只在行的 title 里、
 *      历史钮与区头 ＋ 默认不显示（hover／键盘聚焦才显形）、新建走临时输入行。
 */
test('批次33 文档头归一：一行 .doc-title ＋ 底部 .doc-meta-hint，双层头与聚焦蓝框都不在', async () => {
  const pane = await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))

  // ① 头部只剩一行标题；meta 在底部 hint 上。
  assert.match(pane, /class="doc-head"/u, '编辑面头部要用 .doc-head（一行标题＋右端 quiet 动作）')
  assert.match(pane, /class="doc-title"/u, '头部要有 .doc-title 展示体（章节名／条目名／资料名／剧本名／规则名）')
  assert.ok((pane.match(/class="doc-meta-hint"/g) ?? []).length >= 5,
    `.doc-meta-hint 只落了 ${(pane.match(/class="doc-meta-hint"/g) ?? []).length} 处：每个文档面的 meta 都要沉到底部`)

  // ② 双层头不在场：pane-sub 与它的样式一起退役（身份在竖条、项目名在标题栏，文档头不再念）。
  assert.ok(!pane.includes('pane-sub'), '文档头还留着 .pane-sub 双层头的标题（P18 头部归一：头部只有 .doc-title）')
  assert.ok(!layout.includes('.pane-sub'), 'next-shell.css 里还留着 .pane-sub 的规则（标题已统一走 .doc-title）')
  assert.ok(!pane.includes('nx-pane-header'), '旧头部容器 .nx-pane-header 已被 .doc-head 取代')

  // ③ 写作面聚焦不套框：.editor-area 的规则块不许出现 outline:；:focus-visible 必须「显式 none」
  //    （删规则会留真空，Chrome 的 :focus-visible 默认环顶上来且取 Windows 系统强调色）。
  const area = ruleBody(layout, '.editor-area {')
  assert.ok(area, 'next-shell.css 里没有 .editor-area 规则')
  assert.doesNotMatch(area, /outline\s*:/u, '.editor-area 又在聚焦时画框了：写作面的焦点指示就是光标')
  const focusRule = ruleBody(layout, '.editor-area:focus-visible {')
  assert.ok(focusRule !== null, '.editor-area:focus-visible 规则必须在（显式 none 档 UA 默认环）')
  assert.match(focusRule, /outline:\s*none/u, '.editor-area:focus-visible 必须 outline:none')

  // ④ 核心区面板头（「正文／演示之书 · novel」那一层）已整块删除（批次34）：
  //    CenterSlotHost 的 DOM 里没有 .center-head，next-shell.css 里那条 display:none 也一并退役。
  const centerHost = await readFile(join(shellDir, 'CenterSlotHost.vue'), 'utf-8')
  assert.ok(!centerHost.includes('center-head'), 'CenterSlotHost 还留着 .center-head 的 DOM（批次33 的临时隐藏已该退役）')
  assert.ok(!centerHost.includes('center-sub'), 'CenterSlotHost 还留着 .center-sub（项目名在标题栏，核心区不再念）')
  assert.ok(!layout.includes('.center-head'), 'next-shell.css 里还留着 .center-head 规则（DOM 已删，规则一并退役）')
})

test('批次33 索引窗 IDE 化：行＝名字、版本进 title、历史与新建 hover 显形、新建走临时输入行', async () => {
  const index = await readFile(join(shellDir, 'IndexWindow.vue'), 'utf-8')

  // ① 行＝名字：数字前缀全拆（章节与大纲同一口径）。
  assert.doesNotMatch(index, /\{\{\s*index\s*\+\s*1\s*\}\}/u, '索引窗还在行首印「N. 」数字前缀（IDE 的文件树只写名字）')

  // ② 版本／字数不做常驻 meta：只在行的 title 里（悬停才有）。
  for (const gone of [
    '<span class="workspace-nav-meta">第 {{ item.revision }} 版</span>',
    '{{ item.totalChars }} 字 · 第 {{ item.revision }} 版',
    '{{ item.chars }} 字'
  ]) {
    assert.ok(!index.includes(gone), `索引窗还在行上摆可见 meta：${gone}（应进 title 属性）`)
  }
  assert.ok((index.match(/:title="rowHint\(item\)"/g) ?? []).length >= 5,
    '树行要把「文件名 · 第 N 版 · N 字」放进 title（hover 才出现）')

  // ③ 新建：常驻输入排拆净，区头 ＋ 点开的是临时输入行（Enter 建档、Esc／失焦取消）。
  assert.ok(!index.includes('新章标题'), '常驻的「新章节标题」输入排还在（应只剩区头 ＋）')
  const guarded = (index.match(/v-if="newItem\?\.kind === '/g) ?? []).length
  assert.ok(guarded >= 5, `临时输入行只接了 ${guarded} 棵树的 v-if 守卫（章节／构思／约束／资料／剧本都要有）`)
  const toggles = (index.match(/data-test="index-new-toggle"/g) ?? []).length
  assert.ok(toggles >= 5, `区头 ＋ 只落了 ${toggles} 棵树下`)
  assert.match(index, /@keydown\.enter\.prevent="submitNewItem"/u, 'Enter 才建档')
  assert.match(index, /@blur="closeNewItem"/u, '失焦是取消，不是提交（Esc／失焦都不建档）')

  // ④ 动作 hover 显形：opacity 从 0 起，hover／focus-within／focus-visible 才显出来；
  //    降级动作偏好下不做动画（键盘仍可达：命中区一直在）。
  const style = /<style scoped>([\s\S]*?)<\/style>/u.exec(index)?.[1] ?? ''
  assert.ok(style, 'IndexWindow 的样式块没找到')
  assert.match(ruleBody(style, '.nx-index-history {') ?? '', /opacity:\s*0/u, '历史钮默认应是不可见（hover 才显形）')
  assert.match(style, /\.nx-tree-line:hover \.nx-index-history/u, 'hover 这一行要显形历史钮')
  assert.match(style, /\.nx-tree-line:focus-within \.nx-index-history/u, '键盘聚焦到行内控件也要显形（无鼠标可达）')
  assert.match(style, /\.nx-index-add-toggle:focus-visible/u, '区头 ＋ 要能被键盘聚焦（focus-visible 同样显形）')
  assert.match(style, /prefers-reduced-motion: reduce/u, '降级动作偏好下显形不做动画')
})

/**
 * 协议 v1.2 P18–P21（工单A）：多形态打开的机器钉子。
 *   - 形态词表与状态机只在宿主 paneForms.mjs（P18/P21），载体 SFC 不许出现形态切换逻辑；
 *   - 右键「打开方式」是宿主菜单，条目只来自 manifest.panes 的 forms 声明；
 *   - 浮窗吸附/扩屏是宿主容器职责（P20），分屏副栏 ≥420px（P10/P11）。
 */
test('协议 v1.2 P18–P21 → M2.5-C：形态词表归宿主，状态在 workspace 四轴；浮窗吸附/扩屏与分屏副栏就位', async () => {
  const formsPath = join(shellDir, 'paneForms.mjs')
  assert.equal(await exists(formsPath), true, 'next/shell/paneForms.mjs 必须存在（宿主形态词表）')
  const forms = await readFile(formsPath, 'utf-8')
  assert.match(forms, /PANE_FORMS = Object\.freeze\(\['dock', 'split', 'overlay', 'fullscreen'\]\)/u,
    'P18 词表必须是 dock/split/overlay/fullscreen')
  assert.match(forms, /PANE_FORM_STORAGE_PREFIX = 'paneForm\.'/u, '老键前缀 paneForm.（迁移只用一次）')
  assert.doesNotMatch(forms, /\.localStorage/u, '形态记忆归 workspace（主进程通道），词表模块不碰浏览器缓存')

  // M2.5-C：状态机在 workspace.mjs，四轴一个不少：placement / minimized / geometry / restore。
  const workspace = await readFile(join(shellDir, 'workspace.mjs'), 'utf-8')
  for (const needle of [
    "PLACEMENTS = Object.freeze(['dock', 'split', 'overlay', 'fullscreen'])",
    "MINIMIZED_MODES = Object.freeze(['none', 'bubble', 'collapsed'])",
    'export function createWorkspaceStore',
    'export function instanceIdFor',
    'restorePlacement',
    'setGeometry'
  ]) {
    assert.ok(workspace.includes(needle), `工作区四轴缺：${needle}`)
  }
  assert.doesNotMatch(workspace, /\.localStorage/u, '工作区状态只经主进程通道读写，渲染层不写 localStorage')

  const app = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')
  for (const needle of ['nx-context-menu', '打开方式', 'setPaneForm', 'hostWorkspace', 'nx-split', 'nx-split-side', 'data-split="side"']) {
    assert.ok(app.includes(needle), `AppNext 缺多形态打开的落点：${needle}`)
  }
  assert.match(app, /sanitizePaneForms\(pane\.forms\)/u, '右键菜单必须按 manifest.panes 的 forms 声明列（P18）')

  const widget = await readFile(join(shellDir, 'FloatingWidget.vue'), 'utf-8')
  for (const needle of ['is-snapped-left', 'is-snapped-right', '扩至全屏', "emit('expand')", 'detectSnap']) {
    assert.ok(widget.includes(needle), `FloatingWidget 缺 P20 动作：${needle}`)
  }

  const layout = await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8')
  const sideRule = ruleBody(layout, '.nx-split-side {')
  assert.ok(sideRule, 'next-shell.css 里没有 .nx-split-side 规则（分屏副栏）')
  assert.match(sideRule, /min-width:\s*420px/u, '分屏副栏必须 ≥420px（协议 P10/P11）')

  // P21/P18：载体 SFC 不感知形态——出现宿主状态词即红（今日 next/carriers 里没有 SFC，这条是给后续载体立的钉子）。
  const carrierSfcs = (await walk(join(repoRoot, 'next', 'carriers'))).filter((file) => file.endsWith('.vue'))
  const offenders = []
  for (const file of carrierSfcs) {
    const text = stripComments(await readFile(file, 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
    for (const needle of ['setPaneForm', 'paneForm.', 'paneForms.mjs', 'is-snapped']) {
      if (text.includes(needle)) offenders.push(`${file}: ${needle}`)
    }
  }
  assert.deepEqual(offenders, [], `载体 SFC 不许自带形态切换逻辑（P21：宿主管）：\n${offenders.join('\n')}`)
})
