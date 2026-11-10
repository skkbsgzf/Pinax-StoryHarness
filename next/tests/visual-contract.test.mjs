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
  const titles = (pane.match(/<h2\s[^>]*class="doc-title/gu) ?? []).length
  // 〔批次76 裁定A 改判 P2 的第 1 条〕文档头那一行标题整体上移到窗头（AppNext.windowTitle＝「载体 · 文档」）：
  // 内容层不许再自绘 h2 展示体，否则同一份文档名同屏念两遍、层级也乱掉。
  assert.equal(titles, 0, `内容层还自绘 ${titles} 处 h2.doc-title（批次76 裁定A：唯一标题面＝窗头那一行）`)
  // 白名单只有一处，而且它是「控件」不是标题层级：大纲改名的输入框沿用 .doc-title 的度量。
  // 例外须登记（批次44 口径）——要再加一处，先改这条并写理由。
  assert.equal((pane.match(/class="doc-title outline-title"/gu) ?? []).length, 1,
    '大纲改名输入框是唯一的 doc-title 例外，丢了或多了都是判据漂移')
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
  // 〔批次68-R4 任务1〕组头是纯视觉层，且只有一节的组拍平：目录里不许再出现一行与那一格同义、又点不动的标题。
  assert.match(settings, /<p v-if="group\.labeled" class="settings-group-label" aria-hidden="true"/u,
    'SettingsModal 的分组标题必须是有条件的静态 <p>（aria-hidden，不是 tab、不可点）')
  assert.match(settings, /labeled: \(declaredGroupSize\.value\.get\(name\) \?\? 0\) >= 2/u,
    '单节组拍平的判据要写在声明结构上（搜索把一组滤成一节时组头不许跟着消失）')
  assert.doesNotMatch(settings, /<p class="settings-group-label"/u,
    '组头不许回到无条件渲染——那样「技能」「载体」这类同义组头会重新占一格')
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
 * 批次59 · 铁律一／二：任何打开的内容＝一扇 PaneWindow；chrome 归宿主一个组件。
 * 三条边界都可机读：
 *   1) PaneWindow 是唯一窗口壳——拖动／四角缩放／×／最大化都在它身上；
 *      窗口状态（geometry／z／minimized／maximized／贴靠）的真相在 workspace.json v2；
 *   2) 中间 doc 区＝窗口管理器：AppNext 只接线内容，不维护硬编码坐标表；
 *   3) 旧宿主容器 FloatingWidget 已并入 PaneWindow（文件不存在）。
 * 批次76 〔裁定A／B〕改了这份 chrome 的两处：窗头三枚钮收成一枚 ×（形态切换改走拖拽吸附＋右键菜单），
 * 收起态不再由 PaneWindow 画缘签（呈现归 CollapseOrb）——下面的判据此同步改判并留理由。
 */
test('批次59：PaneWindow 是唯一窗口壳（拖动／缩放／吸附／×／最大化都在宿主）', async () => {
  const windowPath = join(shellDir, 'PaneWindow.vue')
  assert.equal(await exists(windowPath), true, 'next/shell/PaneWindow.vue 必须存在（统一窗口）')
  const widget = await readFile(windowPath, 'utf-8')
  for (const needle of [
    'startDrag',
    'startResize',
    'pointerdown',
    "emit('close')",
    "emit('maximize')",
    "emit('geometry',",
    "emit('snap'",
    'snapTargetAt',
    'snapPreviewBox',
    'nx-pane-snap-preview',
    'getBoundingClientRect',
    'data-window-instance',
    'data-window-state',
    'props.geometry'
  ]) {
    assert.ok(widget.includes(needle), `PaneWindow 缺窗口职责：${needle}`)
  }
  assert.ok(widget.includes('<slot />'), '内容经插槽由外壳注入，宿主不自造载体内容')
  // 〔批次76 裁定A〕铁律一／五：右上角只剩一枚 ×（删记录），形态钮一律不进 chrome——
  // 原判据是 ['collapse','split','close'] 三枚常驻钮，随「相关的页面形态转换按钮用拖拽的形式去做」改判。
  const actions = [...widget.matchAll(/data-window-action="([^"]+)"/gu)].map((match) => match[1])
  assert.deepEqual(actions, ['close'], '窗口动作只剩 ×；收起／分屏两枚钮不进 chrome（改走拖拽与右键菜单）')
  // 三条「不该再长回来」的反向断言卡在真代码上（注释里提旧名不算违规，故用正则而不是 includes）：
  // ①缘签零渲染（守卫①）、②窗头只剩 ×、③窗口壳不再发收起／分屏／展开那三个动作。
  assert.equal(/data-window-action="(collapse|split)"/u.test(widget), false, '窗头不许再有收起／分屏钮（裁定A）')
  assert.equal(/class="[^"]*nx-pane-window-tab/u.test(widget), false, '竖排缘签的渲染必须整条退役（守卫①）')
  assert.equal(/emit\('(collapse|split|expand)'/u.test(widget), false, '形态钮撤了，窗口壳不再发那三个动作')
  const corners = [...widget.matchAll(/data-window-resize="([^"]+)"/gu)].map((match) => match[1])
  assert.deepEqual(corners, ['corner'], '四角把手用 v-for 生成（模板里不应硬列四枚）')
  assert.ok(widget.includes("['nw', 'ne', 'sw', 'se']"), '浮窗要有四角缩放把手')
})

test('批次59：旧宿主容器 FloatingWidget 已并入 PaneWindow（文件删除）', async () => {
  assert.equal(await exists(join(shellDir, 'FloatingWidget.vue')), false, 'FloatingWidget.vue 应已删除；窗口壳只剩 PaneWindow')
})

test('批次59：载体 SFC 不许自带拖拽／定位逻辑（宿主 PaneWindow 负责）', async () => {
  const carriersDir = join(repoRoot, 'next', 'carriers')
  // 今天 next/carriers/ 里还没有 SFC（载体工具/清单都是 .mjs）；这条断言是给后续载体声明
  // pane 时立的钉子——谁把拖拽/定位写进载体 SFC，这里直接红。
  const carrierSfcs = (await walk(carriersDir)).filter((file) => file.endsWith('.vue'))
  const offenders = []
  for (const file of carrierSfcs) {
    const text = stripComments(await readFile(file, 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
    for (const needle of ['pointerdown', 'mousedown', 'localStorage', 'getBoundingClientRect', 'position: absolute', 'position:absolute']) {
      if (text.includes(needle)) offenders.push(`${file}: ${needle}`)
    }
  }
  assert.deepEqual(offenders, [], `载体 SFC 不许自带拖拽/定位（宿主 PaneWindow 负责）：\n${offenders.join('\n')}`)
})

test('批次59：AppNext 挂窗口层与 PaneWindow，不含旧形态入口与硬编码坐标', async () => {
  const app = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')
  assert.ok(app.includes('<PaneWindow'), '外壳要挂统一窗口')
  assert.ok(app.includes('class="nx-window-layer"'), '中间 doc 区是窗口层')
  assert.ok(app.includes(':geometry="win.entry.geometry"'), '几何来自工作区记录（不是外壳的坐标表）')
  // 〔批次76 裁定A〕原判据 `@collapse="collapseWindow"`／`@split="splitWindow"` 随窗头两枚钮撤销：
  // 形态动作在宿主只剩「拖拽吸附（@snap）」与「右键菜单（applyFormAction）」两条，两条都通向同一个状态机。
  assert.ok(app.includes('@snap="applySnapTarget'), '拖拽吸附的落点接到工作区状态机')
  assert.ok(app.includes('snapPlan'), '吸附落点什么形态只从 paneSnap 那张表读（宿主不另写一套）')
  assert.ok(app.includes('@close="closeWindow'), '关窗接到工作区状态机')
  // 〔批次76 裁定B〕收起态的唯一呈现是右下角悬浮球；缘签那条 v-for 与它的排位函数一起没了。
  assert.ok(app.includes('<CollapseOrb'), '外壳挂悬浮球（收起态归它管）')
  assert.ok(app.includes('hostWorkspace.expand'), '从球里放出来走状态机的 expand（按 restore 回原形态）')
  assert.equal(app.includes('tabOrdinal'), false, '缘签的硬编码排位函数（top: 120 + i*36）应随缘签一起删除')
  assert.equal(/v-for="win in sideTabWindows"/u.test(app), false, '收起态不再渲染一竖列窗体')

  assert.equal(app.includes('<FloatingWidget'), false, '旧宿主容器已并入 PaneWindow')
  assert.equal(app.includes('CenterSlotHost'), false, '中栏不再走旧的单槽宿主')
  assert.equal(app.includes('nx-split'), false, '独立分屏外壳已退役（分屏＝同一扇窗的窗态）')
  assert.equal(app.includes('nx-form-bar'), false, '形态条已退役（窗态切换零菜单零模式切换）')
  assert.equal(app.includes('data-form='), false, '旧形态条数据属性不再出现')
  assert.doesNotMatch(app, /\boverlay[_-]?positions?\b/iu, 'AppNext 不许维护窗口的硬编码坐标表')
  assert.doesNotMatch(app, /(?:left|top|right)\s*:\s*['"]?\d+px/u, 'AppNext 不许写窗口的硬编码坐标（定位归 PaneWindow）')
  assert.doesNotMatch(app, /\.localStorage/u, '位置记忆归工作区，AppNext 不碰 localStorage')
})

test('批次59：窗口层与窗口壳的样式就位；层序低于统一二级页', async () => {
  const layout = await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8')
  const layer = ruleBody(layout, '.nx-window-layer {')
  assert.ok(layer, 'next-shell.css 里没有 .nx-window-layer 规则')
  assert.match(layer, /position:\s*relative/u, '窗口层是窗口的定位父级')
  assert.match(layer, /z-index:\s*0/u, '窗口层自成叠层，内联 z 不会和弹窗抢层')
  const rule = ruleBody(layout, '.nx-pane-window {')
  assert.ok(rule, 'next-shell.css 里没有 .nx-pane-window 规则')
  assert.match(rule, /position:\s*absolute/u, '窗口是 absolute 定位卡片')
  // 〔批次76 裁定B〕原判据「收起态要有侧缘小标签（.nx-pane-window-tab，层序 --z-floating-dock）」随缘签退役：
  // 作者口径是「用文字代表吸附、还存在堆叠，看不清也点不到」→ 呈现统一归右下角悬浮球。这里反向断言它不再回来。
  assert.equal(ruleBody(layout, '.nx-pane-window-tab {'), null, '竖排缘签的样式必须整条删除（守卫①）')
  assert.equal(layout.includes('.nx-pane-window-tab'), false, 'next-shell.css 里不许再出现 .nx-pane-window-tab 选择器')
  const orb = ruleBody(layout, '.nx-collapse-orb {')
  assert.ok(orb, 'next-shell.css 里没有悬浮球规则')
  // 〔批次68-R2 任务1〕原判据「悬浮球钉在视口右下角（position: fixed）」随作者口径翻案：
  // 「球悬的应该是主面板右下角，不是 Agent 右下角」——fixed 的 right:24 落点压在 Pi-Agent 右栏上。
  // 判据事实改为 absolute＋主面板（.col-center）是定位父级；判定逻辑（量声明、不放宽）一字未动。
  assert.match(orb, /position:\s*absolute/u, '悬浮球钉在主面板（col-center）右下角')
  const center = ruleBody(layout, '.col-center {')
  assert.ok(center, 'next-shell.css 里没有 .col-center 规则')
  assert.match(center, /position:\s*relative/u, '主面板是悬浮球的定位父级（球跟着主面板走）')
  assert.match(orb, /z-index:\s*var\(--z-floating-action\)/u, '球走既有档位 --z-floating-action，本批不新增层级')
  const orbButton = ruleBody(layout, '.nx-collapse-orb-button {')
  assert.ok(orbButton, '悬浮球本体缺样式')
  assert.match(orbButton, /width:\s*48px/u, '球本体 48×48（判据下限 44 之上）')
  const orbRow = ruleBody(layout, '.nx-collapse-orb-open {')
  assert.ok(orbRow, '球里那条列表缺样式')
  assert.match(orbRow, /min-height:\s*44px/u, '列表每一条整行命中区 ≥44（可点件判据）')
  const snap = ruleBody(layout, '.nx-pane-snap-preview {')
  assert.ok(snap, '拖拽吸附要有预览样式')
  assert.match(snap, /pointer-events:\s*none/u, '预览只是提示，不吃指针')
  // 〔工单验收〕本批不给层级档位表新增任何一档：next-shell.css 只许「用」--z-*，不许「定义」新的。
  assert.equal(/--z-[a-z-]+\s*:/u.test(layout), false, 'next-shell.css 里不许定义新的 --z-* 档位（只读复用 src/styles/main.css 那张表）')
  const tokens = await readFile(join(repoRoot, 'src', 'styles', 'main.css'), 'utf-8')
  const overlayZ = Number(/--z-floating-dock:\s*(\d+)/u.exec(tokens)?.[1])
  const modalZ = Number(/--z-modal:\s*(\d+)/u.exec(tokens)?.[1])
  assert.ok(Number.isFinite(overlayZ) && Number.isFinite(modalZ) && overlayZ < modalZ, `窗口层 z(${overlayZ}) 必须低于统一二级页 z(${modalZ})`)
})

test('批次59：outline manifest 仍声明 overlay pane；打开后走同一扇 PaneWindow', async () => {
  const manifest = await readFile(join(repoRoot, 'next', 'carriers', 'outline', 'manifest.mjs'), 'utf-8')
  assert.match(manifest, /slot: 'overlay'/u, '大纲载体要声明 overlay pane')
  assert.match(manifest, /id: 'outline\.widget'/u, 'overlay pane id 固定 outline.widget')
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
  //    批次44 起这段标记在 EntryDetailPanel.vue 里（条目详情面从 CarrierPaneHost 拆出去了，
  //    因为世界书核心区改成了「上图表列、下详情」两块面板）。合同不变，只改查哪个文件。
  const entryPanel = await readFile(join(shellDir, 'EntryDetailPanel.vue'), 'utf-8')
  assert.match(entryPanel, /data-test="entry-meta-toggle"/u, '编辑面要有一行「条目信息」开关')
  assert.match(entryPanel, /v-if="entryMetaOpen"[^>]*class="entry-meta-edit"/u, '条目字段容器必须是 v-if="entryMetaOpen"（默认折叠，不是 v-show）')
  assert.doesNotMatch(entryPanel, /v-show="entryMetaOpen"/u, '折叠层不许用 v-show 假装折叠（字段仍在 DOM 里）')
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
test('批次33 文档头归一（批次76 改判后）：标题面只剩窗头一行，内容层只留动作行＋底部 .doc-meta-hint', async () => {
  const pane = await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  const appNext = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')

  // ① 头部只剩动作行，标题面归窗头（〔批次76 裁定A〕原合同「头部只有一行 .doc-title」已改判：
  //    作者 2026-11-03 的口径是「打开的第一章显示成『小说 第一章』就行，避免冗余层级」——
  //    那一行整体上移到 PaneWindow 的窗头，内容层不再自绘展示体标题；meta 仍在底部 hint 上）。
  assert.match(pane, /class="doc-head"/u, '编辑面头部要用 .doc-head（保存 chip＋编辑那一行动作）')
  assert.ok(!/<h2\s[^>]*class="doc-title/u.test(pane), '内容层还在自绘 h2.doc-title（标题面唯一＝窗头，批次76 裁定A）')
  assert.match(appNext, /function windowTitle\(win\)/u, '窗头标题的唯一出处是 AppNext.windowTitle（批次76 裁定A 的落点）')
  assert.ok(appNext.includes('`${carrierName} · ${label}`'),
    '窗头必须是「载体名 · 文档名」那一条拼接（批次76 裁定A），不许换回 pane 名或内部 id')
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
 * 批次61 · 页底座（作者裁定①③④）：中心区是「页组 × 页列表 × 每组当前页 × 形态」，
 * 「打开一个页面」不再等于「弹一扇窗」；形态切换走右键，页签上不放常驻形态钮；每页各装一份文档。
 * 这几条断言就是这一批的规格本身——要改断言，先改裁定。
 * （批次59 那版测的是 v2「窗口是唯一实体」，随本批作废：v2 的几何轴与贴靠轴已退役进页组。）
 */
test('批次61：workspace v3 页轴就位，v2 窗口 API 与旧位置四轴零残留', async () => {
  const workspace = await readFile(join(shellDir, 'workspace.mjs'), 'utf-8')
  for (const needle of [
    'WORKSPACE_VERSION = 3',
    "PAGE_GROUPS = Object.freeze(['main', 'side'])",
    "PAGE_FORMS = Object.freeze(['page', 'floating', 'tab'])",
    'export function createWorkspaceStore',
    'export function instanceIdFor',
    'export function repairActive',
    'function pagesOf',
    'function floatingList',
    'function tabList',
    'function setForm',
    'function moveToGroup',
    'function setActive',
    'function setResource',
    'function setGeometry',
    'function setMaximized',
    'function removePanes',
    'function adoptLegacy',
    'export function migrateV1Entry',
    'export function migrateV2Entry'
  ]) {
    assert.ok(workspace.includes(needle), `工作区 v3 缺页轴落点：${needle}`)
  }
  // 只钉「API 还在不在」，不钉字段名：tiledWith／minimized 必须还能被迁移读出来，
  // 但谁都不许再当状态轴用（函数声明形式写死，读旧档的 value.tiledWith 不算违规）。
  // 〔批次76 裁定B〕改判：`function expand` 从这一列移出——v2 那个 expand 是「最小化窗还原成页」，
  // 这一批的 expand 是「从悬浮球里放出来＝回到 restore 记的那一档」，同名不同义，判据换成正向钉（见下）。
  for (const gone of [
    'PLACEMENTS', 'restorePlacement', 'setPinned', 'dockPane', 'place(',
    'function minimize', 'function tile', 'function untile',
    'reconcileTiles', 'MINIMIZED_MODES', 'DEFAULT_MINIMIZED', 'isMinimized'
  ]) {
    assert.equal(workspace.includes(gone), false, `退役的窗口 API 又回来了：${gone}`)
  }
  assert.ok(workspace.includes('function expand'), '〔裁定B〕悬浮球要有唯一放出口：expand(instance) 认 restore')
  assert.ok(workspace.includes('function normalizeRestore'), '收起前那份记忆要有净化入口，脏值不许进状态机')
  assert.equal(workspace.includes('export function normalizeEntry'), true)
  assert.equal(workspace.includes("const geometry = form === 'floating' ? normalizeGeometry(value.geometry) : null"), true,
    '只有浮窗持有矩形：页态藏几何＝重启后位置玄学')
  assert.doesNotMatch(workspace, /\.localStorage/u, '工作区状态只经主进程通道读写，渲染层不写 localStorage')

  const forms = await readFile(join(shellDir, 'paneForms.mjs'), 'utf-8')
  for (const needle of [
    // 批次66（裁定 Q2）：词表收敛成三档，与 FORM_ACTIONS 一一同构——旧词不许回来。
    "PANE_FORMS = Object.freeze(['dock', 'split', 'overlay'])",
    'FORM_ACTIONS',
    'PAGE_ACTIONS',
    'MENU_TARGET_FORM',
    'export function formMenuItems',
    "PANE_FORM_STORAGE_PREFIX = 'paneForm.'"
  ]) {
    assert.ok(forms.includes(needle), `形态词表缺右键菜单落点：${needle}`)
  }
  assert.doesNotMatch(forms, /\.localStorage/u, '词表模块不碰浏览器缓存')

  const app = stripComments(await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  for (const needle of [
    'hostWorkspace',
    '<PaneWindow',
    '<PaneTabStrip',
    '<PaneFormMenu',
    'data-test="window-layer"',
    'pageTierWindows',
    'floatWindows',
    'sideTabWindows',
    'resolveOpenTarget',
    'MENU_TARGET_FORM',
    'pageDataOf',
    'layoutTemplateForBoard'
  ]) {
    assert.ok(app.includes(needle), `AppNext 缺页底座落点：${needle}`)
  }
  for (const gone of [
    'sanitizePaneForms', 'setPaneForm', 'nx-context-menu', 'nx-split', 'nx-form-bar',
    'CenterSlotHost', 'FloatingWidget', '打开方式',
    '.minimize(', '.tile(', 'tiledWith', 'tileSide'
  ]) {
    assert.equal(app.includes(gone), false, `AppNext 仍有退役的窗口轴／形态入口：${gone}`)
  }
  // 原判据里有 '.expand('（v2 窗口轴的那枚还原方法）。〔批次76 裁定B〕宿主现在合法地调
  // hostWorkspace.expand()——那是「从悬浮球回原形态」的唯一入口，不是那条旧轴。
  // 所以这里把「不许出现 .expand(」改成「出现的每一处都只能是状态机的 expand」，判据不放松，只是换了写法。
  const expandCalls = [...app.matchAll(/[\w$]+\.expand\(/gu)].map((match) => match[0])
  assert.ok(expandCalls.length > 0, '宿主要有从球里放出来的那一句')
  for (const call of expandCalls) {
    assert.equal(call, 'hostWorkspace.expand(', `expand 只许通向工作区状态机，别处不许：${call}`)
  }
  // 〔批次76 裁定A〕窗头两枚形态钮撤了，宿主侧对应的 splitWindow 也随之删除（不留没人按的旁路）。
  assert.equal(app.includes('splitWindow'), false, '窗头「分屏」钮撤了，宿主那句实现一起删；落位归 applySnapTarget 与菜单')
  assert.equal((app.match(/<PaneWindow/gu) ?? []).length, 1, '页层与浮窗层同一条 v-for（〔裁定B〕收起态那一条已删——缘签不再渲染窗体）')
  // 〔裁定①〕缺省落点是页：全文件只有两处开窗。批次61 那句「唯一带 floating 的那处是显式悬浮钮」
  // 在批次62 长了两条：Alt＋点击页签、Alt＋点击竖条——它们同样是作者明说的意图（手势＝显式），
  // 变的是入口，没变的是「缺省不许浮出一扇窗」。所以这里把三处来源逐一点名，而不是放开计数。
  assert.equal((app.match(/hostWorkspace\.open\(/gu) ?? []).length, 2, '开页只该有两条口：routeOpen 与索引窗的悬浮钮')
  assert.equal((app.match(/form:\s*'floating'/gu) ?? []).length, 3, '浮窗只有三处来源：Alt＋点页签、Alt＋点竖条（批次62 的显式手势），以及索引窗那枚「悬浮」钮')
  assert.match(app, /form: decision\.form \?\? 'page'/u, 'routeOpen 开页的缺省形态仍是页：floating 只能由 decision.form（＝手势传进来的入参）改写')
  assert.match(app, /function toggleBoardOverlay[\s\S]{0,600}form: 'floating'/u, '索引窗那枚显式悬浮钮仍是浮窗落点之一')

  const layout = await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8')
  for (const needle of ['.nx-page-tabstrip', '.nx-page-tab', '.nx-pane-window.is-page', '.nx-pane-window.is-page.is-in-side', '.nx-collapse-orb', '.nx-collapse-orb-open', '.nx-pane-snap-preview']) {
    assert.ok(layout.includes(needle), `页底座缺样式落点：${needle}`)
  }
  for (const gone of ['.nx-overlay-widget', '.nx-overlay-bubble', '.nx-split-side', '.nx-split-main', '.nx-form-bar', '.is-tiled', '.nx-pane-window-tab']) {
    assert.equal(layout.includes(gone), false, `next-shell.css 还留着退役形态的规则：${gone}`)
  }

  const paneWindow = stripComments(await readFile(join(shellDir, 'PaneWindow.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  for (const needle of ['@contextmenu', "emit('menu'", "'is-page'", "'is-in-side'", 'data-window-group', "state === 'page'"]) {
    assert.ok(paneWindow.includes(needle), `PaneWindow 缺 v3 形态落点：${needle}`)
  }
  for (const gone of ['minimized', 'tiledWith', 'tileSide', '.nx-pane-window-btn--tile']) {
    assert.equal(paneWindow.includes(gone), false, `PaneWindow 还读 v2 窗口轴：${gone}`)
  }

  // 〔裁定③〕页签上只有「关这一页」一枚钮：形态切换一律走右键，不做常驻死按钮。
  const tabStrip = stripComments(await readFile(join(shellDir, 'PaneTabStrip.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  for (const needle of ['data-page-instance', 'aria-selected', '@contextmenu', 'data-test="page-tabstrip"']) {
    assert.ok(tabStrip.includes(needle), `页签栏缺落点：${needle}`)
  }
  assert.equal((tabStrip.match(/<button/gu) ?? []).length, 1, '页签上只该有 × 一枚钮（右键才是形态入口）')
  assert.doesNotMatch(tabStrip, /data-window-action/u, '页签不放窗口动作钮')

  // 载体 SFC 不感知窗口状态（今日 next/carriers 里没有 SFC，这条是给后续载体立的钉子）。
  const carrierSfcs = (await walk(join(repoRoot, 'next', 'carriers'))).filter((file) => file.endsWith('.vue'))
  const offenders = []
  for (const file of carrierSfcs) {
    const text = stripComments(await readFile(file, 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
    for (const needle of ['setPaneForm', 'paneForm.', 'paneForms.mjs', 'hostWorkspace', 'nx-pane-window']) {
      if (text.includes(needle)) offenders.push(`${file}: ${needle}`)
    }
  }
  assert.deepEqual(offenders, [], `载体 SFC 不许自带窗口状态逻辑（宿主 PaneWindow 管）：\n${offenders.join('\n')}`)
})

test('批次59：布局模板是宿主词汇；folder 有树，web／gallery 没有硬编码左栏', async () => {
  const templates = await readFile(join(shellDir, 'layoutTemplates.mjs'), 'utf-8')
  for (const needle of ['LAYOUT_TEMPLATES', "'folder'", "'web'", "'gallery'", 'templateHasTree', 'layoutTemplateForBoard']) {
    assert.ok(templates.includes(needle), `布局模板注册表缺：${needle}`)
  }
  assert.match(templates, /entries-workspace/u, 'web 模板按 pane kind 推断，不靠改清单')
  assert.match(templates, /worldbook\./u, '世界书按 id 前缀认 web（批次60 前先跑起来）')

  const app = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')
  assert.match(app, /v-if="showIndexWindow"/u, '索引窗是 folder 模板的一个 pane，不再无条件渲染')
  assert.match(app, /templateHasTree\(layoutTemplateForBoard\(board\)\)/u, '竖条点击也按模板决定是否开树')

  const index = await readFile(join(shellDir, 'IndexWindow.vue'), 'utf-8')
  assert.equal(index.includes('打开方式'), false, '索引窗不再上报宿主形态菜单')
  assert.equal(index.includes("'context-menu'"), false, '索引窗不再有形态菜单事件')
  assert.ok(index.includes('nx-context-menu'), '大纲／章节自己的右键菜单仍在（内容操作，不是窗口动作）')
})

test('〔批次68-R2 任务二／W5〕世界书三栏维基阅读版：死口径 260px:1fr:min(46%,430px)、图谱卡右上角、窄屏折下、wiki 皮挂对容器', async () => {
  // 新增判据随登记进册（工单禁止边界口径）：这条只钉版式声明与挂载词汇，不放宽任何既有守卫。
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))

  // ① 三栏死口径（工单原文：「树:阅读:Infobox 起排 260px : 1fr : min(46%,430px)」）。
  assert.match(ruleBody(layout, '.nx-wiki-tree {'), /flex:\s*0 0 260px/u, '树列起排 260px')
  assert.match(ruleBody(layout, '.nx-wiki-center {'), /flex:\s*1 1 auto/u, '阅读列吃剩余')
  assert.match(ruleBody(layout, '.nx-wiki-infobox {'), /flex:\s*0 0 min\(46%, 430px\)/u, '信息卡 min(46%,430px)')
  // 收起态只收窄自己——阅读列吃满是 flex 自然给出，不许借收起改三栏其它声明。
  assert.match(ruleBody(layout, '.nx-wiki-infobox.is-collapsed {'), /flex:\s*0 0 auto/u, '信息卡收起＝一钮收窄')
  // 〔批次 W5〕关系图从信息卡竖栏搬进阅读列右上角：卡片宽 ≈300–360px、画布 210px、
  // hover 以右上角为原点放大（只向左下扩，不给阅读列造横滚条）；信息卡里的旧缩览块整体退役。
  assert.match(ruleBody(layout, '.nx-wiki-corner {'), /flex:\s*0 1 340px/u, '图谱卡起排 340px')
  assert.match(ruleBody(layout, '.nx-wiki-corner {'), /max-width:\s*360px/u, '图谱卡上限 360px')
  assert.match(ruleBody(layout, '.nx-wiki-graph-card {'), /--nx-entry-graph-height:\s*210px/u, '图谱卡画布 210px')
  assert.match(ruleBody(layout, '.nx-wiki-graph-card {'), /transform-origin:\s*top right/u, 'hover 放大以右上角为原点')
  assert.match(ruleBody(layout, '.nx-wiki-graph-card:hover {'), /transform:\s*scale\(1\.12\)/u, 'hover 放大图谱卡')
  assert.equal(layout.includes('.nx-wiki-infobox-graph'), false, '信息卡里的旧图谱缩览块要随搬迁删净')
  const graphVue = stripComments(await readFile(join(shellDir, 'EntryGraph.vue'), 'utf-8'))
  assert.match(graphVue, /height:\s*var\(--nx-entry-graph-height,\s*340px\)/u, '图谱画布默认高度仍是 340px，卡片由变量给')

  // ② 窄窗口语义：信息卡折到阅读列下方（工单②「@media 语义」）。
  assert.match(layout, /@media[^{]*\{[\s\S]*?\.nx-wiki-infobox\s*\{[^}]*order:\s*3[^}]*\}/u, '窄屏信息卡要折到阅读列下方')

  // ③ wiki 皮只加在渲染产物上（mdRender 管线一字不动）：规则全部挂 .entry-text.nx-wiki-article——
  //    .entry-text 在展示体白名单族内（68-R1 闸⑯），这里不许出现新的 --font-display 声明。
  assert.match(ruleBody(layout, '.entry-text.nx-wiki-article h2 {'), /border-bottom:/u, 'h2 章节底线')
  assert.match(ruleBody(layout, '.entry-text.nx-wiki-article > p:first-of-type {'), /font-size:\s*var\(--nx-fs-xl\)/u, '首段导语走刻度档位')
  assert.match(ruleBody(layout, '.entry-text.nx-wiki-article blockquote {'), /border-inline-start:/u, '引用块竖线')
  assert.match(ruleBody(layout, '.entry-text.nx-wiki-article .nx-wikilink {'), /border-radius:\s*var\(--nx-radius-pill\)/u, '蓝链胶囊走 --nx-radius-pill 刻度')
  assert.doesNotMatch(layout, /--font-display:[^;]*;[\s\S]{0,80}?\.nx-wiki/u, 'wiki 皮不许自己声明展示体')
  // 〔批次 W5 密度〕正文行距／段距、h1/h3 层级、信息卡行分隔：全部走刻度或相对单位，不新造字号档。
  assert.match(ruleBody(layout, '.entry-text.nx-wiki-article {'), /line-height:\s*1\.78/u, '阅读面行距收一档')
  assert.match(ruleBody(layout, '.entry-text.nx-wiki-article p {'), /margin:\s*0 0 0\.72em/u, '段距按 em 跟字号走')
  assert.match(ruleBody(layout, '.entry-text.nx-wiki-article h3 {'), /font-size:\s*var\(--nx-fs-lg\)/u, '三级题走刻度')
  assert.match(ruleBody(layout, '.nx-wiki-infobox-rows dt {'), /border-top:/u, '信息卡行间发丝线')
  assert.match(ruleBody(layout, '.nx-wiki-infobox-rows dt {'), /padding:\s*4px 0/u, '信息卡行密度')

  // ④ 挂载词汇：三栏排版在 EntriesBoard；关系列表在信息卡只摆一遍（详情面 wiki 态让位）；
  //    图谱卡挂阅读列首的 corner 插槽（entries-graph-card 一族），信息卡里不再有第二个图谱。
  //    批次44／60 的两段式容器随结构翻案退役（不许留半截死 DOM）。
  const board = await readFile(join(shellDir, 'EntriesBoard.vue'), 'utf-8')
  for (const needle of [
    'entries-wiki-cols', 'entries-tree-col', 'entries-center-col', 'entries-infobox',
    'entries-infobox-collapse', 'entries-infobox-expand', 'entries-anchor-toggle',
    'entries-graph-card', 'entries-graph-card-collapse', 'entries-graph-card-expand'
  ]) {
    assert.ok(board.includes(`data-test="${needle}"`), `EntriesBoard 缺三栏／图谱卡锚点：${needle}`)
  }
  assert.equal(board.includes('data-test="infobox-graph"'), false, '信息卡旧图谱锚点要随搬迁删净')
  assert.equal(board.includes('variant="infobox"'), false, 'EntryGraph 的 infobox 挂载位退役')
  assert.match(board, /<template v-if="hubModel\.entries\.length" #corner>/u, '图谱卡经 corner 插槽挂到阅读列首')
  // 修复②：零计数锚点默认不摆，开关是唯一唤出口（沉默层）；模型不动，只在渲染层筛。
  assert.match(board, /showEmptyAnchors\.value \|\| placeholder\.count > 0/u, '零计数锚点组默认收起')
  assert.match(board, /@click="showEmptyAnchors = !showEmptyAnchors"/u, '锚点开关要真能唤出空组')
  assert.ok(board.includes('wiki'), '中栏详情面要以 wiki 态挂载')
  const panel = await readFile(join(shellDir, 'EntryDetailPanel.vue'), 'utf-8')
  assert.match(panel, /wiki:\s*\{\s*type:\s*Boolean/u, '详情面要有 wiki 开关（默认关，独立详情面行为不动）')
  assert.match(panel, /class="doc-title nx-wiki-title"/u, '条目名＝大标题（阅读列首，展示体走 .doc-title 白名单族）')
  assert.match(panel, /<slot name="corner" \/>/u, '阅读列首要给关系图卡留 corner 槽位')
  // 修复①：正文首个 H1 与条目名相同时，视图标题不再重复渲染。
  assert.match(panel, /entryContentLeadsWithName/u, '详情面要判正文首个标题是否与条目名重复')
  assert.match(panel, /v-if="showWikiTitle" class="doc-title nx-wiki-title"/u, '重复时视图标题不渲染（正文那个 H1 保留）')
  assert.match(panel, /!data\.editingEntry && !wiki && entryRelations\.length/u, 'wiki 态下关系列表让位信息卡（同一份数据不摆两遍）')
  const pane = await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')
  assert.ok(!pane.includes('nx-entries-workspace-board') && !pane.includes('nx-entries-workspace-detail'), '两段式容器已翻案退役，不许留死壳')
  const graph = stripComments(await readFile(join(shellDir, 'EntryGraph.vue'), 'utf-8'))
  assert.match(graph, /variant === 'corner' \? 'entries-graph-card-graph' : 'entries-graph'/u, '图谱卡分身要有独立锚点')
  assert.equal(graph.includes("'infobox'"), false, 'infobox 挂载位退役')
})

test('〔批次68-R2 任务三〕composer 卡片三层钉死：＋ 单通路、状态排真读数、模型 chip 无清单不可点、不摆麦克风死钮、停止占发送位', async () => {
  // 新增判据随登记进册：这条钉结构锚点与数据口径，不放宽任何既有守卫。
  const dialog = stripComments(await readFile(join(shellDir, 'AssistantDialog.vue'), 'utf-8'))

  // ① 三层锚点：卡片（输入行＋控件排）→ 状态排 → 状态排下方的明细折叠区。
  for (const needle of [
    'data-test="composer-card"',
    'data-test="composer-controls"',
    'data-test="composer-plus"',
    'data-test="composer-model-chip"',
    'data-test="composer-status"',
    'data-test="status-inflight"',
    'data-test="status-envelope"',
    'data-test="status-tokens"',
    'data-test="composer-more"'
  ]) {
    assert.ok(dialog.includes(needle), `composer 三层缺锚点：${needle}`)
  }
  // 卡片把老 input-row 收在怀里（测试选择器家族 .authoring-knowledge__input-row textarea 不许改结构）。
  assert.match(dialog, /data-test="composer-card"[\s\S]*?authoring-knowledge__input-row[\s\S]*?data-test="composer-controls"/u,
    '卡片里必须是「输入行在上、控件排在下」这一序')

  // ② 麦克风不摆死钮（语音后端本批不做，屏上连字都不许出现；模板注释里的这句话不算上屏）。
  assert.ok(!dialog.replace(/<!--[\s\S]*?-->/gu, '').includes('麦克风') && !dialog.includes('composer-mic'), '麦克风不该作为钮/锚点出现')

  // ③ 模型 chip：无清单＝disabled（只显示不可点——不编造）；在途读数走宿主真计数。
  assert.match(dialog, /class="control-quiet nx-composer-model"[\s\S]{0,200}:disabled="!modelNames\.length"/u,
    '模型 chip 无清单时必须不可点（并落在共享控件词汇 control-quiet 里）')
  assert.match(dialog, /inflight:\s*\{\s*type:\s*Number/u, '状态排「在途」是宿主传下来的计数，不是 busy 的另一种拼写')
  const dock = stripComments(await readFile(join(shellDir, 'RuntimeDock.vue'), 'utf-8'))
  assert.match(dock, /const inflightCount = ref\(0\)/u, 'RuntimeDock 的 ask 计数要进模板，得先是响应式')
  assert.match(dock, /:inflight="inflightCount"/u, '计数没传给 composer 状态排')

  // ④ 停止钮只在 busy 时出现，且就站在发送钮那一格（v-if/v-else 同一位）。
  assert.match(dialog, /v-if="busy"[\s\S]{0,200}data-test="composer-stop"[\s\S]*?v-else[\s\S]{0,120}authoring-knowledge__send/u,
    '停止与发送共用发送位：busy 显停止，否则显发送')

  // ⑤ 「＋」插入菜单只许复用同一条插触发符通路（openSkillMenu 与 pickInsert 都走 insertTrigger）。
  const triggerCalls = dialog.match(/insertTrigger\(/gu)?.length ?? 0
  assert.ok(triggerCalls >= 3, '＋菜单与 skill.menu 键位必须共用 insertTrigger 这一条通路')

  // ⑥ 状态排缺数据如实「未回报」，不许换算冒充。
  assert.match(dialog, /上下文 \$\{Number\(envelopeReading\.blocks\)[\s\S]*?上下文 未回报/u, 'envelope 读数没有真事件时是「未回报」')
  assert.match(dialog, /本轮 tokens 未回报/u, 'usage 没有回报时是「未回报」')

  // ⑦ 新样式的字号/圆角一律走刻度（门禁⑭⑮的整块读数之外，这里点名三处新档）。
  assert.match(dialog, /\.nx-composer-card \{[^}]*border-radius:\s*var\(--radius-surface\)/u, '卡片圆角走 token')
  assert.match(dialog, /\.nx-composer-status \{[^}]*font-size:\s*var\(--nx-fs-2xs\)/u, '状态排字号走刻度')
  assert.match(dialog, /\.nx-composer-model \{[^}]*border-radius:\s*var\(--nx-radius-pill\)/u, '模型 chip 圆角走刻度')
})

test('〔批次76 任务4-4〕遍历点名的各处小命中区：度量声明都过 24 这条线', async () => {

  // 判据是**度量级**的（jsdom 没有排版，量不出真实 getBoundingClientRect）：
  // 逐条取规则体，① 正向钉住补上去的那一档尺寸，② 反向扫「声明了的 px 尺寸不许 < 24」。
  // 真机逐屏复测（<24×24 计数）仍记在「未真机复核」的账上，不由这条测试冒充。
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  const scoped = async (file) => stripComments(await readFile(join(shellDir, file), 'utf-8'))
  const rules = [
    ['next-shell.css · 关闭这一页（实测 20×36）', layout, '.nx-page-tab-close {', /width:\s*24px/u],
    ['next-shell.css · 快捷词入口（实测 45×22）', layout, '.nx-tools-toggle {', /min-height:\s*24px/u],
    ['next-shell.css · 快捷词 chip（同族）', layout, '.nx-tools-chip {', /min-height:\s*24px/u],
    ['next-shell.css · 可点双链（inline 锚点扩命中区）', layout, '.nx-wikilink {', /padding:\s*3px/u],
    ['EntriesBoard.vue · 世界书表头「按 X 排序」（实测 20–21×36）', await scoped('EntriesBoard.vue'), '.nx-entries-table th .nx-entries-sort {', /min-height:\s*24px/u],
    ['IndexWindow.vue · 新建资料（实测 22×22）', await scoped('IndexWindow.vue'), '.nx-index-icon-btn {', /width:\s*24px/u],
    ['AssistantDialog.vue · 审阅模式徽标（实测 40×23）', await scoped('AssistantDialog.vue'), '.authoring-knowledge__mode-badge {', /min-height:\s*24px/u],
    // 〔批次77-R2 任务6〕‹ › 是两个字符的可点件，字号小、本体窄，命中区必须靠尺寸声明撑到 24×24。
    ['AssistantDialog.vue · 分支切换器 ‹ ›', await scoped('AssistantDialog.vue'), '.authoring-knowledge__branch-step {', /min-width:\s*24px/u],
    ['AssistantDialog.vue · 分支切换器计数格', await scoped('AssistantDialog.vue'), '.authoring-knowledge__branch-count {', /min-height:\s*24px/u]
  ]
  const offenders = []
  for (const [label, css, selector, pin] of rules) {
    const body = ruleBody(css, selector)
    if (!body) {
      offenders.push(`${label}：找不到规则 ${selector}`)
      continue
    }
    if (!pin.test(body)) offenders.push(`${label}：规则体里没有 ${pin}`)
    for (const match of body.matchAll(/(?:^|;)\s*(?:width|height|min-height|min-width)\s*:\s*(\d+)px/gu)) {
      if (Number(match[1]) < 24) offenders.push(`${label}：还留着 ${match[0].trim()}（<24px）`)
    }
  }
  assert.deepEqual(offenders, [], `小命中区没补到 ≥24×24：\n${offenders.join('\n')}`)
})

/**
 * 〔批次77 守卫⑥〕正文渲染单一来源。
 *
 * 工单那句话：**对话正文只走 mdRender，出现第二处 Markdown 拼装即红**。
 * 这条钉三件事，全是源码级（jsdom 量不出排版，视觉对不对归实拍）：
 *   1. 任何 `.vue` 里有 `v-html=`，它就必须 import `mdRender.mjs`——
 *      「把字符串当 HTML 塞进 DOM」这个动作在 Next 外壳里只有那一把钥匙；
 *   2. `marked`／`dompurify` 只许出现在 `mdRender.mjs` 里——第二个解析器＝第二套拼装，
 *      也是打包门禁 f（渲染层依赖薄）最容易被人顺手绕开的那道口子；
 *   3. 反向钉住对话正文确实走的是那把钥匙（`answerHtml` → `renderMarkdown`），
 *      并且**用户消息**没有跟着走 md——作者打的 `**字**` 必须原样回显。
 */
test('〔批次77 守卫⑥〕正文渲染单一来源：v-html 只认 mdRender，第二处 Markdown 拼装即红', async () => {
  const files = (await walk(shellDir)).filter((file) => /\.(?:vue|mjs)$/u.test(file))
  assert.ok(files.length > 10, 'next/shell 扫描面空了等于没测')

  const offenders = []
  for (const file of files) {
    const source = await readFile(file, 'utf-8')
    const relative = file.slice(shellDir.length + 1).replace(/\\/gu, '/')
    if (file.endsWith('.vue') && /v-html[=\s]/u.test(source) && !/from '\.{1,2}(?:\/[^']*)?mdRender\.mjs'/u.test(source)) {
      offenders.push(`${relative}：有 v-html 却没 import mdRender.mjs`)
    }
    if (relative !== 'mdRender.mjs' && /\bfrom '(?:marked|dompurify)'/u.test(source)) {
      offenders.push(`${relative}：直接引了 marked／dompurify（第二处 Markdown 拼装）`)
    }
    if (relative !== 'mdRender.mjs' && /\bmarked\.parse\s*\(/u.test(source)) {
      offenders.push(`${relative}：自己调了 marked.parse`)
    }
  }
  assert.deepEqual(offenders, [], `正文渲染不止一个来源：\n${offenders.join('\n')}`)

  // 正向：助手正文那条路径确实存在（改名或退回纯文本插值，这里就红）。
  const dialog = await readFile(join(shellDir, 'AssistantDialog.vue'), 'utf-8')
  assert.match(dialog, /function answerHtml[\s\S]{0,120}renderMarkdown\(/u, '助手正文没走 renderMarkdown')
  assert.match(
    dialog,
    /class="[^"]*authoring-knowledge__answer-text[^"]*authoring-knowledge__markdown[\s\S]{0,160}v-html="answerHtml\(message\.text\)"/u,
    '助手正文容器不是 md 版（v-html＋markdown 类名都要在）'
  )
  // 反向：用户消息保持纯文本插值——它不该被当成 Markdown。
  const questionBlock = dialog.match(/<div class="authoring-knowledge__question"[\s\S]*?<\/div>/u)?.[0] ?? ''
  assert.ok(questionBlock.length > 0, '找不到用户消息那一块（结构变了要连这条一起改）')
  assert.equal(/v-html/u.test(questionBlock), false, '用户消息走了 v-html：作者打的标记符号会被改写')
  assert.match(questionBlock, /\{\{ message\.text \}\}/u, '用户消息不再是原样插值')
})

/**
 * 〔批次76-R2 守卫⑪〕页态无窗头。
 *
 * jsdom 没有排版、也没有真实的窗口层叠，量不出「这扇窗有几行 chrome」——所以这一批的两条新守卫
 * 都落在**声明级**：钉源码里那一行的存在性与归属，不钉量出来的像素。
 * 运行时那一半（DOM 里到底有没有 nx-pane-window-head）在 shell-ui.spec.mjs 的用例里验。
 */
test('〔批次76-R2 守卫⑪〕页态不渲染窗头：nx-pane-window-head 只属于浮窗／最大化那一档', async () => {
  const paneWindow = stripComments(await readFile(join(shellDir, 'PaneWindow.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  // ① 那一句 v-if 就贴在 header 上，条件是「不是页态」——写成常驻渲染＝守卫⑪红。
  assert.match(paneWindow, /<header[^>]*v-if="state !== 'page'"[^>]*\n?\s*class="nx-pane-window-head"/u,
    '窗头必须按 state !== page 条件渲染（页态的标题面是页签，不是第二行）')
  // ② 拖拽／双击／右键三个手势仍挂在那一行上（浮窗靠它，撤了浮窗就没法拖了）。
  const head = paneWindow.slice(paneWindow.indexOf('class="nx-pane-window-head"'))
  for (const needle of ['@pointerdown="startDrag"', '@dblclick="onTitleDblclick"', '@contextmenu="onContextMenu"']) {
    assert.ok(head.slice(0, 400).includes(needle), `浮窗窗头缺手势落点：${needle}`)
  }
  // ③ 页态的拖拽起点靠宿主转发：startDrag 必须暴露出去（否则页签那一下接不回同一份吸附实现）。
  assert.match(paneWindow, /defineExpose\(\{[^}]*startDrag[^}]*\}\)/u, 'PaneWindow 要把 startDrag 暴露给宿主（页签行是页态的拖拽起点）')
  // ④ 吸附判定与预览不许有第二套实现：仍然只有 paneSnap 那一份。
  assert.match(paneWindow, /from '\.\/paneSnap\.mjs'/u, '吸附判定必须来自 paneSnap（不能有第二份）')

  // ⑤ 顶上那行视图切换条整条退役：样式与宿主 markup 都不许再留（〔任务3〕判据＝同屏不出两行列同一批 pane）。
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  for (const gone of ['.nx-center-tabs', '.nx-center-tab']) {
    assert.equal(layout.includes(gone), false, `next-shell.css 还留着退役的切换条规则：${gone}`)
  }
  const app = stripComments(await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  for (const gone of ['nx-center-tabs', 'center-pane-tabs', 'chooseCenterPane', 'centerPaneTabs']) {
    assert.equal(app.includes(gone), false, `AppNext 还留着顶部切换条那一行：${gone}`)
  }
  assert.equal((app.match(/<style scoped>/gu) ?? []).length, 0, 'AppNext 的 scoped 样式块只为那行切换条存在，行撤了块也撤（不留空壳）')
  // ⑥ 职责并进页签条：三处接线缺一不可（待开签的数据、点开它的那一句、页态拖拽起点）。
  const tabStrip = stripComments(await readFile(join(shellDir, 'PaneTabStrip.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  for (const needle of ['pendingPanes', 'data-pending-pane', 'open-pane', "entry.form !== 'page'", 'emit(\'drag\'']) {
    assert.ok(tabStrip.includes(needle), `页签条缺合并后的落点：${needle}`)
  }
  assert.equal((tabStrip.match(/<button/gu) ?? []).length, 1, '待开签是签不是钮：页签条上仍只许 × 一枚钮（〔裁定③〕不做常驻死按钮）')
  // 〔批次76-R3 任务1〕那三处接线原样保留，只是**落点从全局那一条移进各组自己的条**：
  // 待开签的数据仍是 `pendingCenterPanes` 现算的那一份（不另存清单），条上仍按 `grp.pendingPanes` 接进去，
  // 点开仍走 `openCenterPane`，拖拽起点仍是 `onTabDragStart`。判据不加不减，只把「一条」换成「每组一条」。
  for (const needle of [':pending-panes="grp.pendingPanes"', '@open-pane="openCenterPane"', '@drag="onTabDragStart"', ':group="grp.id"']) {
    assert.ok(app.includes(needle), `AppNext 没把那一行接回本组的页签条：${needle}`)
  }
  assert.ok(app.includes('const pendingCenterPanes'), 'AppNext 要现算「这块板还没开出来的中栏面」（不是另存一份清单）')
  assert.ok(app.includes('pendingPanes: pending'), '待开签要挂进组条的数据里（挂哪组＝缺省开出那一组＝主组）')
  // 每组一列、条是列内首行：列容器与分组标识都要在，且**只剩这一处**页签条站点（全局那一条已撤）。
  assert.equal((app.match(/<PaneTabStrip/gu) ?? []).length, 1, '页签条只有一个渲染站点，按组 v-for——不许回潮成「全局一条＋组内各一条」')
  for (const needle of ['v-for="grp in centerGroups"', 'class="nx-pane-group"', ':data-pane-group="grp.id"', 'const centerGroups = computed']) {
    assert.ok(app.includes(needle), `AppNext 缺页组列的落点：${needle}`)
  }
  assert.equal(app.includes('tabStripPages'), false, '全局那一条的数据源已撤（留着就是第二本账）')
  for (const needle of ['.nx-pane-group', '.nx-pane-group.is-overlay-group', '.nx-pane-group.is-blurred-group', '.nx-page-tabstrip.is-group-side']) {
    assert.ok(layout.includes(needle), `next-shell.css 缺页组列的样式落点：${needle}`)
  }
  const groupRule = ruleBody(layout, '.nx-pane-group {')
  assert.ok(groupRule, 'next-shell.css 里没有 .nx-pane-group 规则')
  assert.match(groupRule, /flex-direction:\s*column/u, '组列必须是 flex 列：签行才是「组内首行」，不浮不叠')
  assert.match(groupRule, /flex:\s*1 1 0/u, '组列按组等分（两组各半＝原来的分屏，一组就铺满）')
  assert.match(groupRule, /min-width:\s*0/u, '组列缺 min-width:0：签一多就把半屏撑破')
  assert.equal(/position\s*:/u.test(groupRule), false,
    '〔守卫④的根〕组列本身不许定位：一给列定位，页态窗拖拽量到的「层」就缩水成半个屏，吸附分界跟着改判')
})

/**
 * 〔批次76-R2 任务1 + 守卫⑫〕应用面高度链与 chrome 减层。
 *
 * 症状（工单实测）：窗 body 830px → `.pane` 量到 216px → `.nx-app-pane` 的 height:100% 拍平在内容上
 * → iframe 只剩 150px。作者那句「你限制了它的宽高，那它怎么去展示出自己」是这一条的由来。
 * 判据是声明级的：链上每一环都只许写 flex 撑高＋min-height:0，**不许出现 height:auto／height:100% 断点**
 * （jsdom 量不出 clientHeight，真机半屏复测记在批记录的「未真机复核」账上，不由这条测试冒充）。
 *
 * 〔批次76-R3 任务2〕链首多两环：页态窗从「窗层直接子项」变成**组列那一根 flex 列的子项**（列内首行是签行），
 * 于是「组列 → 页态窗」这两环也在同一张板上，缺一条就整条断——只加不减，原有各环原样保留。
 */
test('〔批次76-R2 守卫⑫〕应用面高度链：窗 body → pane → 应用面 → iframe，一环都不许写回 auto', async () => {
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  const carrierSource = await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')
  const hostSource = await readFile(join(shellDir, 'ExternalAppHost.vue'), 'utf-8')
  // 一个文件可能有多段 <style>，把每段都取出来拼一起——只取最后一段会看漏前面那环。
  const scopedOf = (source) => [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map((m) => m[1]).join('\n')

  // leaf=true 的那一环是 iframe 本体：它是这条 flex 列的**子项**，自己不必是 flex 容器，
  // 但它照样得写 flex:1 1 auto + min-height:0，否则父级给的高度吃不到。
  // 〔批次76-R3 任务2〕页态窗与组列进场后，这个旗标的含义＝「只当 flex 子项、不要求自己声明 display:flex」：
  // 页态窗的那句 display:flex 写在基座 .nx-pane-window 上（不在 .is-page 那条规则里），照旧继承得到。
  const chain = [
    ['next-shell.css · .nx-pane-group（〔76-R3〕组列＝签行＋窗所在的那根 flex 列，链首）', layout, '.nx-pane-group {', false],
    ['next-shell.css · .nx-pane-window.is-page（〔76-R3〕页态窗＝组列子项，缺 min-height:0 长稿就撑破整列）', layout, '.nx-pane-window.is-page {', true],
    ['next-shell.css · .nx-pane-window-body（本批从块容器改成 flex 列——断点就在这）', layout, '.nx-pane-window-body {', false],
    ['next-shell.css · .pane（载体面板根）', layout, '.pane {', false],
    ['CarrierPaneHost · .nx-app-pane', scopedOf(carrierSource), '.nx-app-pane {', false],
    ['CarrierPaneHost · :deep(.nx-external-app)', scopedOf(carrierSource), '.nx-app-pane :deep(.nx-external-app) {', false],
    ['ExternalAppHost · .nx-external-app（根）', scopedOf(hostSource), '.nx-external-app {', false],
    ['ExternalAppHost · .nx-external-app-frame（iframe 本体＝链尾，flex 子项）', scopedOf(hostSource), '.nx-external-app-frame {', true]
  ]
  const offenders = []
  for (const [label, css, selector, leaf] of chain) {
    const body = ruleBody(css, selector)
    if (!body) {
      offenders.push(`${label}：找不到规则 ${selector}`)
      continue
    }
    if (!leaf && !/display:\s*flex/u.test(body)) offenders.push(`${label}：不是 flex 容器，flex:1 不生效`)
    if (!/min-height:\s*0/u.test(body)) offenders.push(`${label}：缺 min-height:0（内容一撑就把链顶断）`)
    if (!/flex:\s*1/u.test(body)) offenders.push(`${label}：缺 flex:1 …（吃不到父级给的高度）`)
    if (/height:\s*(auto|100%)/u.test(body)) offenders.push(`${label}：还留着 height:auto／100% 断点`)
  }
  assert.deepEqual(offenders, [], `应用面高度链有断点：\n${offenders.join('\n')}`)

  // 〔任务4〕应用面＝iframe 独占：常驻的网址行与底部复制脚行都不许留在内容层。
  // 判据只看**代码**（注释里记录「撤了什么」是留痕，不是还画着）——所以先剥注释再查。
  const codeOf = (source) => stripComments(source).replace(/<!--[\s\S]*?-->/gu, '')
  const hostCode = codeOf(hostSource)
  const carrierCode = codeOf(carrierSource)
  for (const gone of ['nx-external-app-head', 'nx-external-app-url', 'nx-external-app-source']) {
    assert.equal(hostCode.includes(gone), false, `ExternalAppHost 还自绘地址行：${gone}`)
  }
  for (const gone of ['nx-app-pane-foot', 'nx-app-copy-note', 'app-copy-url', 'app-copy-note']) {
    assert.equal(carrierCode.includes(gone), false, `CarrierPaneHost 还留着常驻脚行：${gone}`)
  }
  assert.equal((hostCode.match(/<iframe/gu) ?? []).length, 1, '应用面只有一块内嵌浏览器（不多不少）')
  // 地址改走**读数**通道：属性留档 + 上抛宿主（页签 tooltip／状态栏／右键菜单都吃这一份）。
  for (const needle of ['data-app-url', 'data-app-url-source', "defineEmits(['address'])", 'emit(\'address\'']) {
    assert.ok(hostSource.includes(needle), `ExternalAppHost 的地址读数通道缺落点：${needle}`)
  }
  // 安全属性一字未动（工单禁止边界；这里正向钉住，防止「顺手清理」把它改了）。
  assert.match(hostSource, /referrerpolicy="no-referrer"/u, 'iframe 的 referrerpolicy 不许动')
  assert.match(hostSource, /sandbox="allow-scripts allow-forms allow-same-origin allow-popups"/u, 'iframe 的 sandbox 白名单不许动')

  // 宿主侧三个读处都在（页签 tooltip／状态栏那一段／右键菜单那一项），且地址只有一处来源。
  const app = stripComments(await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  for (const needle of ['onAppAddress', 'addressOf(', 'copyAppAddress(', 'statusAddress', 'appAddress']) {
    assert.ok(app.includes(needle), `AppNext 缺地址上抛后的落点：${needle}`)
  }
  const strip = stripComments(await readFile(join(shellDir, 'PaneTabStrip.vue'), 'utf-8'))
  assert.ok(strip.includes('data-page-address') && strip.includes('entry.address'), '页签 tooltip 没带上地址')
  const status = await readFile(join(shellDir, 'StatusBar.vue'), 'utf-8')
  assert.ok(status.includes('data-test="status-address"') && status.includes('address: { type: String'), '状态栏没接地址那一段')
  const menu = await readFile(join(shellDir, 'PaneFormMenu.vue'), 'utf-8')
  assert.ok(menu.includes('copy-url') && menu.includes('复制地址单开'), '「复制地址单开」没搬进右键菜单')
  // 内容组件不许自己去碰剪贴板（复制归宿主那一份菜单，不留第二条旁路）。
  assert.equal(/clipboard[\s\S]{0,120}app/i.test(hostSource), false, 'ExternalAppHost 不该自己抄地址')
})

/**
 * 〔批次76-R3 守卫⑬「有窗必有签」〕声明级那一半（运行时那一半在 shell-ui.spec.mjs 的用例里）。
 *
 * 作者裁定：「右边半个屏既然跟左边共用分屏，就必须显示出那个窗口的名字」→ 页签行**按页组出**，
 * 一条只列本组的页；任何摊开在屏幕上的页态窗，头顶必须有本组那一行条。
 * jsdom 没有排版，所以这里钉的是**源码里的归属规则**：谁进哪一条、空组出不出条、条挂在哪一层。
 */
test('〔批次76-R3 守卫⑬〕有窗必有签：一条只列本组、空组不出条、条是组内首行', async () => {
  const tabStrip = stripComments(await readFile(join(shellDir, 'PaneTabStrip.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  // ① 组是条的属性：`group` 进 props，DOM 上留 `data-tabstrip-group`（守卫⑬运行时就按这一格认归属）。
  assert.match(tabStrip, /group: \{ type: String, default: 'main' \}/u, '页签条必须按组出：group 是它的属性')
  for (const needle of [':data-tabstrip-group="group"', 'is-group-${group}']) {
    assert.ok(tabStrip.includes(needle), `页签条缺分组标识的落点：${needle}`)
  }

  const app = stripComments(await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '')
  // ② 归属规则只有一条，且写在数据层（不是渲染层临时拼的）：侧组条＝侧组的页；主组条＝本组的页＋没有页组归宿的那些。
  assert.ok(app.includes("row.form === 'page' && row.group === 'side'"), '侧组条要只列侧组的页')
  assert.ok(app.includes("row.form !== 'page' || row.group !== 'side'"), '主组条要收留浮窗／收起态那些没有页组归宿的页')
  assert.match(app, /const pages = own\.filter\(\(row\) => row\.form === 'page'\)[\s\S]{0,200}return \[\.\.\.pages, \.\.\.orphans\]/u,
    '主组条的序＝本组的页在前、收留的挂条尾')
  // ③ 空组不出条：侧组那一列只在侧组真有页时进 centerGroups（「有条无内容」与「有窗无签」同为违规态）。
  assert.match(app, /if \(sideWindow\) \{\s*groups\.push\(\{/u, '侧组列必须按「侧组有没有摊开的页」决定出不出现')
  assert.match(app, /if \(mainWindow \|\| mainStripPages\.value\.length \|\| pending\.length\)/u,
    '主组列的出场条件＝有本组的页 / 有条尾收留的页 / 有待开签，三者都没有就不出列')
  // ④ 高亮各亮各组的：每条读的是本组 active，全局那一份 currentInstance 已撤（留着就是第二本账）。
  assert.ok(app.includes('function groupCurrentInstance(group)'), '每组的高亮要按本组的当前页算')
  assert.match(app, /const active = snap\.active\?\.\[group\]/u, '高亮的读数只能来自工作区 v3 的 active（不另存一份）')
  assert.equal(app.includes('const currentInstance = computed'), false, '全局那一份「此刻那一页」的高亮已随全局条撤掉')
  // ⑤ 条在列内、且列只有一个渲染站点：签行是列内首行（不是绝对定位浮在上面，也不许回潮成「全局一条＋组内各一条」）。
  const markup = app.slice(app.indexOf('v-for="grp in centerGroups"'))
  assert.ok(markup.indexOf('<PaneTabStrip') < markup.indexOf('<PaneWindow'), '组列里签行必须排在窗之前（组内首行）')
})

/**
 * 〔批次68-R1 门禁⑭〕字号单轨：壳层里「字有多大」只有一本刻度。
 *
 * 症状（工单实测）：同屏九档——--nx-fs-*(11/13/15/17/19) 与老轨 --fs-sm(12)/--fs-base(14) 双刻度并存，
 * 各 SFC 的 scoped 里再散着裸 14/13/12/11px、21px、.88em，加上没样式化的 md 节点从浏览器缺省里冒出
 * 13.33/22.5/30px。刻度不是审美偏好，是「同一块板上有多少种密度」的唯一读数口，所以这里钉三条：
 *   1. 不许再引老轨那两个 token（var(--fs-…)）；
 *   2. 不许再写裸 px 字号——`font:` 简写里的也算（那条最容易被人顺手写回去）；
 *   3. 白名单只有两类：导出/下载用的**独立 HTML**（它脱离本软件排版，不是壳层 UI），
 *      与第三方内嵌件。文楷正文面不豁免——它的字号走 --writing-* 与 --nx-fs-* 两条正常通道。
 * var(--nx-fs-*, 11px) 这种「带兜底值的 token 引用」不算裸 px：真读数仍是刻度。
 */
const FONT_SIZE_ALLOWLIST = [
  // 导出 HTML 自带样式：那是一份脱离外壳排版的独立文档（工单：第三方／导出面白名单）。
  { file: 'exportService.mjs', reason: '导出的 HTML 自带 <style>，不是壳层 UI' }
]

test('〔批次68-R1 门禁⑭〕字号单轨：壳层样式不引 --fs-* 老轨、不写裸 px 字号', async () => {
  const sources = await authoredStyleSources()
  assert.ok(sources.length > 10, 'next/shell 样式扫描面空了等于没测')
  const offenders = []
  const allowed = (path) => FONT_SIZE_ALLOWLIST.some((entry) => path.endsWith(entry.file))
  for (const source of sources) {
    if (allowed(source.path)) continue
    const css = stripComments(source.text)
    // var(--nx-fs-2xs, 11px) 那种「带兜底值的 token 引用」真读数是刻度，不算裸 px：
    // 先把 var() 的整段参数摘掉再找数，剩下的才是写在值位上的裸 px／em。
    const tokenless = css.replace(/var\([^()]*\)/gu, 'var()')
    // 值位上的裸 px：font-size 直接给数，或 `font:` 简写里藏一个数。
    for (const match of tokenless.matchAll(/font-size\s*:\s*[^;}]*?\b\d+(?:\.\d+)?px/gu)) {
      offenders.push(`${source.path}: ${match[0].trim().slice(0, 60)}`)
    }
    for (const match of tokenless.matchAll(/\bfont\s*:\s*[^;}]*\b\d+(?:\.\d+)?px/gu)) {
      offenders.push(`${source.path}: ${match[0].trim().slice(0, 60)}`)
    }
    // 老轨那两个 token 不再被引：刻度只剩 --nx-fs-* 一本。
    for (const match of css.matchAll(/var\(\s*--fs-(?:sm|base)\b/gu)) {
      offenders.push(`${source.path}: ${match[0]}（老轨刻度，改 --nx-fs-*）`)
    }
  }
  // 相对值（.88em／1.08em 那一类）会把同一块板上的读数乘出第六、第七档——一并钉住。
  for (const source of sources) {
    if (allowed(source.path)) continue
    const tokenless = stripComments(source.text).replace(/var\([^()]*\)/gu, 'var()')
    for (const match of tokenless.matchAll(/font-size\s*:\s*(?:\.\d+|\d*\.?\d+)em\b/gu)) {
      offenders.push(`${source.path}: ${match[0].trim()}（相对字号会飘出新档，改 --nx-fs-*）`)
    }
  }
  assert.deepEqual(offenders, [], `字号不在 --nx-fs-* 五档上：\n${offenders.join('\n')}`)

  // 正向：五档 token 真的在被用（全改成别的写法不该让这条也「绿」）。
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  const layoutWithoutSpaces = layout.replace(/\s+/gu, '')
  for (const token of ['--nx-fs-2xs', '--nx-fs-md', '--nx-fs-lg', '--nx-fs-xl', '--nx-fs-2xl']) {
    assert.ok(layoutWithoutSpaces.includes(`var(${token}`), `布局层没用 ${token}：刻度定义成了摆设`)
  }
})

/**
 * 〔批次68-R1 门禁⑮〕文案去行话：作者看得见的地方不写实现口径。
 *
 * 工单的两条实锤（思维链那句「批次77 留位，批次78 接子代理时一并接」、地址来源的「（清单声明）」）
 * 都不是个案，是一类：**注释可以记排线，屏上不行**。这条把话变成机器判据——
 * 剥掉注释之后，next/shell 的每一份源码里再出现批次号或那四个工程词，就是又有一句实现口径走上屏。
 * 词表按工单点名的那四条加「批次\d+」；显示层的转写表（sourceVocabulary.mjs）认的是 source 标识、
 * 不是中文 label，所以它不需要在这份词表上开口子。
 */
const BANNED_ON_SCREEN_WORDS = [
  { pattern: /批次\s*\d+/gu, label: '批次号（排线计划不上屏）' },
  { pattern: /清单声明/gu, label: '「清单声明」' },
  { pattern: /工程覆盖/gu, label: '「工程覆盖」' },
  { pattern: /承载位/gu, label: '「承载位」' },
  { pattern: /写族闸/gu, label: '「写族闸」' }
]

test('〔批次68-R1 门禁⑮〕出屏文案不含批次号与工程词：注释可记排线，界面上不行', async () => {
  const files = (await walk(shellDir)).filter((file) => /\.(?:vue|mjs|css)$/u.test(file))
  assert.ok(files.length > 10, 'next/shell 扫描面空了等于没测')
  const offenders = []
  for (const file of files) {
    const raw = await readFile(file, 'utf-8')
    // 三类注释全剥：JS 块注释、JS 行注释、模板注释。行注释只在**前面是空白或行首**时剥——
    // 否则 'http://127.0.0.1' 这种地址会被剥掉半句，把该看的东西看成不存在（假绿比假红更坏）。
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^[ \t]*\/\/[^\n]*$/gmu, '')
      .replace(/(^|[\t ])\/\/[^\n]*/gu, '$1')
      .replace(/<!--[\s\S]*?-->/gu, '')
    for (const { pattern, label } of BANNED_ON_SCREEN_WORDS) {
      pattern.lastIndex = 0
      for (const match of code.matchAll(pattern)) {
        offenders.push(`${file.slice(shellDir.length + 1).replace(/\\/gu, '/')}：${label} →「${match[0]}」`)
      }
    }
  }
  assert.deepEqual(offenders, [], `实现行话走上屏了：\n${offenders.join('\n')}`)

  // 正向：两处实锤确实改成了作者语言（改回别的句子要连这条一起想清楚）。
  const timeline = await readFile(join(shellDir, 'ConversationTimeline.vue'), 'utf-8')
  assert.match(timeline, /这一轮没有思维链文本，只记录了运行过程/u, '思维链那句没换成作者语言')
  const appNext = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')
  assert.match(appNext, /APP_URL_SOURCE_WORDS = Object\.freeze\(\{\s*override: '[^']*地址',\s*manifest: '[^']*地址'/u,
    '地址来源那两词不是作者语言（应说「插件自带的地址／本机改过的地址」）')
})

/**
 * 〔批次68-R1 门禁⑯〕字体三族的使用面：一族只回答一个问题。
 *
 * 决策表在 记录 §1：interface＝一切 UI chrome；display（文楷）＝**只**归正文阅读／编辑面与世界书条目正文；
 * mono＝只归真正的代码上下文。三轨混跑的根因不是有人写错了字族，是 **--font-writing 名义上是「写作面」、
 * 实际是 Menlo／Consolas 等宽栈**——把它挂在正文面上，正文就成了代码的样子。
 * jsdom 量不出排版，所以这条钉声明级：谁引了哪一个族，一眼能看到。
 * 选择器归属用「就近前一个 {」反推，@media 里嵌套的规则也能认（嵌套时那个 { 就是 @media 自己那一个）。
 */
const DISPLAY_FACE_ALLOWLIST = [
  '.editor-area', '.doc-title', '.doc-field', '.entry-text', '.doc-reading', '.nx-writing-text'
]
const MONO_FACE_ALLOWLIST = [
  'code', 'kbd', 'samp', 'pre', '.history-diff-line', '.nx-writing-preview-text'
]
const ELEMENT_FACES = new Set(['code', 'kbd', 'samp', 'pre'])

/** 选择器片段是否真的用了那个元素族：裸元素名要整段相等，'.preview-text' 不能被 'pre' 蒙过去。 */
function faceMatches(part, face) {
  // Vue 的 :deep(code) 与 :deep(.entry-text) 是作用域穿透写法，判族时按里面那层选择器算。
  const normalized = part.replace(/:deep\(([^)]*)\)/gu, '$1')
  if (!ELEMENT_FACES.has(face)) return normalized.includes(face)
  return normalized.split(/[\s>+~]+/u).some((token) => {
    if (token === face) return true
    if (!token.startsWith(face)) return false
    const next = token[face.length]
    return typeof next === 'string' && '.:['.includes(next)
  })
}

/**
 * 从一处 var(--font-*) 反推「它挂在哪条声明、哪一条选择器上」。
 * 反推错一次就会把整条规则的声明当成选择器（那样每条都算越界，门禁红得没有信息量）：
 * 声明取花括号后按 ; 切开的最后一段，选择器取上一条规则收尾到本规则花括号之间、并剥掉 @media 那一层。
 */
function faceRuleContext(css, index) {
  const brace = css.lastIndexOf('{', index)
  if (brace < 0) return null
  const declaration = css.slice(brace + 1, index).split(';').pop().trim()
  if (!/^font(?:-family)?\s*:/u.test(declaration)) return null
  const previousRuleEnd = css.lastIndexOf('}', brace)
  const selector = css.slice(previousRuleEnd + 1, brace).split('{').pop().replace(/\s+/gu, ' ').trim()
  return selector ? { selector } : null
}

test('〔批次68-R1 门禁⑯〕字体三族使用面：chrome 里出 display／mono 即红，--font-writing 全域退役', async () => {
  const sources = await authoredStyleSources()
  const offenders = []
  for (const source of sources) {
    const css = stripComments(source.text)
    const relative = source.path.slice(shellDir.length + 1).replace(/\\/gu, '/')
    for (const match of css.matchAll(/(--font-writing|--font-display|--font-mono)\b/gu)) {
      const context = faceRuleContext(css, match.index)
      if (!context) continue
      if (match[1] === '--font-writing') {
        offenders.push(`${relative}：还引着 --font-writing（等宽栈冒充写作字体，正文面改 --font-display）→ ${context.selector}`)
        continue
      }
      const allowlist = match[1] === '--font-display' ? DISPLAY_FACE_ALLOWLIST : MONO_FACE_ALLOWLIST
      const parts = context.selector.split(',').map((part) => part.trim()).filter(Boolean)
      const strays = parts.filter((part) => !allowlist.some((face) => faceMatches(part, face)))
      if (strays.length) offenders.push(`${relative}：${match[1]} 出在不该用的选择器上 → ${strays.join(' / ')}`)
    }
  }
  assert.deepEqual(offenders, [], `字体三族的使用面越界了：\n${offenders.join('\n')}`)

  // 正向：正文面确实在文楷那一轨上（把 .editor-area 改回系统等宽，这里就红）。
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  for (const selector of ['.editor-area {', '.doc-reading {', '.entry-text {', '.nx-writing-text {']) {
    const body = ruleBody(layout, selector)
    assert.ok(body, `布局层找不到 ${selector}`)
    assert.match(body, /font-family:\s*var\(--font-display\)/u, `${selector} 不在文楷那一轨上`)
  }
  // 老轨导航词汇那一段（Arial 漏的落点）必须在壳层把族指回界面栈——src/** 不许动，清作用面只有这一处。
  assert.match(layout, /\.theme-legacy \.app-shell \.workspace-sidebar \.workspace-nav-label\s*\{[^}]*font-family:\s*var\(--font-interface\)/u,
    '索引窗左栏的族没改指壳层 token：老轨那份 --font-sans＋硬编码仍会漏进界面')
  // 工具面那一叠不再是等宽主读数（46 行裸 id 是工单点名的症状）。
  const dialog = await readFile(join(shellDir, 'AssistantDialog.vue'), 'utf-8')
  assert.match(dialog, /class="authoring-knowledge__agent-name"/u, '工具面没有中文名那一读')
  assert.equal(/<code>\{\{\s*tool\.name\s*\}\}<\/code>/u.test(dialog), false, '工具面又回到「一行裸 id 的等宽 code」')
})

/**
 * 〔批次68-R3 门禁⑰〕沉默层：零收起＋零通知＝悬浮球整颗不渲染。
 *
 * 作者口径（2026-11-07 裁定经工单转述）：「看见的每样东西都意味着『这里有东西』——
 * 没有东西就看不见任何容器」。v1 的「球没内容也常驻（它是拖拽落点）」翻案：
 * paneSnap 的吸附目标是视口角落的纯几何（snapTargetAt），不看 DOM，球藏了收起链路照常在。
 * 判据分两半：声明级钉在这里（两处 v-if＋两句空态句必须绝迹）；运行时那一半在
 * shell-ui.spec「统一 chrome」用例里（零收起零通知 → collapse-orb 不在 DOM）。
 */
test('〔批次68-R3 门禁⑰〕沉默层：球在零收起零通知时零渲染，空态句与常驻跳转钮绝迹', async () => {
  const orb = stripComments(await readFile(join(shellDir, 'CollapseOrb.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/gu, '')
  // ① 组件根：显隐谓词只看「有没有收起的页」与「有没有未确认通知」——提案数不参与（那是组内的事）。
  assert.match(orb, /<div v-if="count \|\| hasNotice" class="nx-collapse-orb"/u, '球根节点没有沉默层的 v-if（count 与 hasNotice 都不成立时必须整颗不渲染）')
  assert.match(orb, /v-if="hasNotice" class="nx-collapse-orb-group" data-test="orb-notice-group"/u, '通知组要只在有通知时出现')
  // ② 两句空态文案（「现在没有收起的面板…」「服务侧没有待确认通知。」）不许以任何形式回来。
  for (const gone of ['现在没有收起的面板', '服务侧没有待确认通知', 'nx-collapse-orb-empty']) {
    assert.equal(orb.includes(gone), false, `空态句退役了又回来：${gone}`)
  }
  // ③ 跳转不再常驻：通知跳转融进每一行，提案跳转进「AI 产出」组（组本身按 proposalCount 出现）。
  assert.equal(orb.includes('nx-collapse-orb-jump'), false, '常驻跳转钮的样式类不许回来')
  assert.equal(orb.includes('data-test="orb-open-services"'), false, '「看通知与日志」不再作为常驻钮存在（跳转在行内）')
  assert.match(orb, /v-if="proposalCount > 0"[\s\S]{0,80}data-test="orb-proposal-group"/u, 'AI 产出组要按提案数出现')
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  assert.equal(layout.includes('.nx-collapse-orb-empty'), false, '空态句的样式该随句子一起删')
  assert.equal(layout.includes('.nx-collapse-orb-jump'), false, '常驻跳转钮的样式该随钮一起删')
  // ④ 宿主侧（〔调度方补刀·翻案〕）：执行方原判「AppNext 挂载处同款 v-if」与组件常驻挂载互斥——
  //    组件级 v-if 让 CollapseOrb 晚于宿主 onWindowKeydown 注册，Esc 分层（stopImmediatePropagation）
  //    失效，面板开着按 Esc 身后窗口照样被收（真窗实测）。终口径：组件**常驻挂载**，宿主挂载处禁止
  //    v-if，沉默层由组件根 v-if 独立承担（上面①）；宿主侧钉的是「orbVisible 谓词不得回潮成挂载条件」。
  const app = stripComments(await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/gu, '')
  assert.equal(/<CollapseOrb\s+v-if=/u.test(app), false, 'CollapseOrb 组件必须常驻挂载：挂载处不得出现 v-if（Esc 分层依赖监听先注册）')
  assert.equal(app.includes('const orbVisible ='), false, 'orbVisible 谓词不得回潮（显隐唯一出处是组件根 v-if）')
})

/**
 * 〔批次68-R3 门禁⑱〕空态可行动：模板里的空态文案必须同容器带可点钮，否则逐个登记白名单。
 *
 * 扫描面＝各 SFC 的 <template> 文本（剥 HTML 注释、剥引号属性值——细节收进 title 是许可动作，
 * 不算上屏文案）。词根取工单点名的四个：还没有／没有内容／请从／请先。
 * 判据：命中行同句或其后两行内有**不属于别的分支**的 `<button` ＝同容器有主操作（通过）；否则必须能在白名单里逐条对上
 * （file + snippet），对不上就是「又写了一句只指路不给动作的死话」。白名单条目失效同样红——
 * 这本账不许攒僵尸条目。
 */
const EMPTY_STATE_ALLOWLIST = [
  { file: 'CarrierPaneHost.vue', snippet: '还没有可用的词', reason: '纯只读：快捷词由世界书条目与正文词频自动收录，没有可点的主操作' },
  // 〔批次68-R5 任务1〕左栏各树空态改为「一句话＋同排新建钮」（照「新建大纲」先例），
  // R3 登记的那几条 hover-＋ 例外全部就地消化，账不留僵尸：构思／资料／约束／剧本／记录／条目／章节。
  { file: 'EntriesBoard.vue', snippet: '这一栏还没有条目', reason: '看板区：新建入口在本板顶栏（类别＋标题＋新建）' },
  { file: 'EntryGraph.vue', snippet: '还没有登记关系', reason: '纯只读图：关系由条目面板登记，图上不造第二入口' },
  { file: 'SettingsModal.vue', snippet: '该载体的设置项还没有内容', reason: '纯只读：载体没声明设置项，任何动作都是假口' },
  { file: 'settings/BackupSection.vue', snippet: '还没有打开项目', reason: '状态层读数：入口在顶栏「打开项目」，备份节里不复制第二个开门钮' },
  { file: 'MaterialGallery.vue', snippet: '还没有记录', reason: '新建输入与钮就在同容器下方（超出 ±2 行窗口，逐条登记）' },
  { file: 'settings/ExportSection.vue', snippet: '还没有打开的文档', reason: '动作在索引窗（先去开文档），本节不复制一条假导出钮' },
  { file: 'settings/HistorySection.vue', snippet: '还没有历史快照', reason: '快照由定时器自动落，无主操作可给' },
  { file: 'settings/ImportSection.vue', snippet: '还没有写入任何文件', reason: '预览读数句；执行钮 import-apply 在同一计划块里（超出 ±2 行窗口）' },
  { file: 'settings/ProposalsSection.vue', snippet: '还没有提案', reason: '提案由模型／运行时写下，节内无可造提案的动作' }
]

test('〔批次68-R3 门禁⑱〕空态文案要么带同容器主操作钮，要么逐条在白名单里', async () => {
  const files = (await walk(shellDir)).filter((file) => file.endsWith('.vue'))
  assert.ok(files.length > 10, 'next/shell 扫描面空了等于没测')
  const TOKEN = /还没有|没有内容|请从|请先/u
  const violations = []
  const used = new Set()
  for (const file of files) {
    const raw = await readFile(file, 'utf-8')
    const start = raw.indexOf('<template')
    if (start < 0) continue
    const template = raw.slice(start, raw.lastIndexOf('</template>') + 11)
      .replace(/<!--[\s\S]*?-->/gu, '')
      // 引号属性值整体剥掉：title 是「细节进悬浮说明」的许可落点，不算常驻文案。
      .replace(/(?:@|:)?[\w.-]+="[^"]*"/gu, '=""')
    const lines = template.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!TOKEN.test(lines[i])) continue
      // 「同容器有主操作」的机器近似：命中行前后两行内出现 <button，且那一行不是分支入口
      // （带 v-if／v-else 的钮属于**另一条路**，替不了这一句）。只按行数开窗会被邻枝的钮蒙过去，
      // 于是「只指路不给动作」的死话也能过关——分支指令这道判断就是来堵这个的。
      const actionable = lines.slice(Math.max(0, i - 2), i + 3).some((line) => (
        line.includes('<button') && !/\bv-(if|else)/u.test(line)))
      if (actionable) continue
      const relative = file.slice(shellDir.length + 1).replace(/\\/gu, '/')
      const hit = EMPTY_STATE_ALLOWLIST.find((entry) => relative.endsWith(entry.file) && lines[i].includes(entry.snippet))
      if (hit) {
        used.add(hit)
        continue
      }
      violations.push(`${relative}:${i + 1} 「${lines[i].trim().slice(0, 60)}」`)
    }
  }
  assert.deepEqual(violations, [], `空态句只指路不给动作，又没登记白名单：\n${violations.join('\n')}`)
  const stale = EMPTY_STATE_ALLOWLIST.filter((entry) => !used.has(entry))
  assert.deepEqual(stale, [], `白名单里有对不上号的僵尸条目（改完文案要连同账本一起清）：\n${stale.map((entry) => `${entry.file}#${entry.snippet}`).join('\n')}`)

  // 正向：载体空态指南（判据 #2 的主落点）八块板都在——每块「一句话＋去索引窗钮」成套。
  const carrier = stripComments(await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/gu, '')
  const guides = carrier.match(/class="pane-hint nx-empty-guide"/gu) ?? []
  assert.ok(guides.length >= 8, `载体空态指南只剩 ${guides.length} 块（章／构思／大纲／提案／约束／资料／剧本／记录，一块都不许退回去）`)
  const goButtons = carrier.match(/data-test="empty-go-index"/gu) ?? []
  assert.equal(goButtons.length, guides.length, '每一块空态指南都要配恰好一枚「去索引窗」主钮（点了真的去）')
  assert.match(carrier, /const emit = defineEmits\(\['history', 'address', 'focus-index'\]\)/u, 'focus-index 事件要从这里上抛宿主')
  const app = stripComments(await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/gu, '')
  assert.ok(app.includes('@focus-index="focusIndexColumn(win.entry)"'), '宿主没接住 focus-index（钮点了不会去）')
  assert.match(app, /function focusIndexColumn\(entry\)[\s\S]{0,200}indexOpen\.value = true/u, 'focus-index 的落点要真的打开索引窗')
})

/**
 * 〔批次68-R3 门禁⑲〕指南层：设置节常驻文案不得含机制 token。
 * 〔批次68-R4 任务2 扩展面登记〕扫描面从「settings/*.vue 的 <template>」扩到两处：
 *   ① 加上目录本体 SettingsModal.vue（设置弹窗里常驻的话，不只是各节的话）；
 *   ② 加上各文件的 <script> 字符串字面量——R3 只看模板，把常驻句写在 computed 里就能绕过
 *      （PrefsSection 的探测结果句正是这一形态：serve:pinax 藏在脚本串里上了屏）。
 * 脚本侧只查含汉字的字面量：那是要读给人听的话；'outline.json'、payload.dryRun 这类
 * 逻辑常量与标识符不是文案，不在这个面里（判据按「上屏的话」划，不按「文件里有没有这个词」划）。
 */
const MECHANISM_TOKENS = [
  { pattern: /\.pinax\//gu, label: '.pinax/ 路径' },
  { pattern: /backup-manifest/gu, label: 'backup-manifest.json' },
  { pattern: /\.json\b/gu, label: '*.json 文件名' },
  { pattern: /history\.git/gu, label: 'history.git' },
  { pattern: /\bdryRun\b/gu, label: 'dryRun' },
  { pattern: /serve:pinax/gu, label: 'serve:pinax 端点名' },
  // 〔批次68-R4〕开发口径的进程名与「面」系黑话：常驻文案一律换成作者读得懂的「模型服务」。
  { pattern: /\bpi-agent\b|任务面/gu, label: 'pi-agent／任务面（进程黑话）' },
  { pattern: /模型面/gu, label: '模型面（与按钮「检测模型服务」不同词表）' }
]

/**
 * 脚本段的字面量取样：单引号／双引号／反引号都算，模板串的 ${…} 里嵌套的字面量并回同一句
 * （否则一句常驻话被插值截断，后半句里的机制词就从这一闸眼皮底下溜走）。
 * 注释逐字符跳过——注释是实现说明，不上屏；串里的 `//`（如 http://127.0.0.1）不会被当成注释。
 */
function scanStringEnd(text, i) {
  const quote = text[i]
  let j = i + 1
  while (j < text.length) {
    const c = text[j]
    if (c === '\\') { j += 2; continue }
    if (c === quote) return j + 1
    if (quote !== '`' && c === '\n') return j
    if (quote === '`' && c === '$' && text[j + 1] === '{') { j = skipBraces(text, j); continue }
    j += 1
  }
  return j
}

function skipBraces(text, i) {
  let depth = 0
  let j = i
  while (j < text.length) {
    const c = text[j]
    if (c === '{') { depth += 1; j += 1; continue }
    if (c === '}') { depth -= 1; j += 1; if (depth === 0) return j; continue }
    if (c === "'" || c === '"' || c === '`') { j = scanStringEnd(text, j); continue }
    j += 1
  }
  return j
}

/** 取出每一处字符串字面量的正文；模板串 ${…} 里的嵌套字面量并进同一句（一句话被插值截开也算一句）。 */
function collectLiterals(text, out = []) {
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch === '/' && text[i + 1] === '/') {
      i += 2
      while (i < n && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      let body = ''
      let closed = false
      while (j < n) {
        const c = text[j]
        if (c === '\\') { body += text[j + 1] ?? ''; j += 2; continue }
        if (c === ch) { closed = true; break }
        if (ch !== '`' && c === '\n') break
        if (ch === '`' && c === '$' && text[j + 1] === '{') {
          const end = skipBraces(text, j)
          const nested = []
          collectLiterals(text.slice(j + 2, end - 1), nested)
          body += nested.join('')
          j = end
          continue
        }
        body += c
        j += 1
      }
      i = closed ? j + 1 : j
      if (body) out.push(body)
      continue
    }
    i += 1
  }
  return out
}

test('〔批次68-R3 门禁⑲／批次68-R4 扩展〕设置弹窗常驻文案不含机制 token（title／细节折叠除外）', async () => {
  const settingsDir = join(shellDir, 'settings')
  const files = (await readdir(settingsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.vue'))
    .map((entry) => join(settingsDir, entry.name))
  assert.ok(files.length >= 14, `设置节扫描面只有 ${files.length} 份（应有 14 节），空了等于没测`)
  // 〔批次68-R4〕目录本体进面：SettingsModal 的常驻话（空态、搜索无命中、组头）也归这一闸管。
  const scoped = [...files, join(shellDir, 'SettingsModal.vue')]
  const offenders = []
  for (const file of scoped) {
    const raw = await readFile(file, 'utf-8')
    const relative = file.slice(shellDir.length + 1).replace(/\\/gu, '/')
    const start = raw.indexOf('<template')
    if (start >= 0) {
      let template = raw.slice(start, raw.lastIndexOf('</template>') + 11)
        .replace(/<!--[\s\S]*?-->/gu, '')
        // title／占位符这类悬浮说明是许可落点：整值剥掉再查常驻文本。
        .replace(/(?:@|:)?[\w.-]+="[^"]*"/gu, '=""')
      template = template.replace(/<details[\s\S]*?<\/details>/gu, '') // 「细节」折叠整块豁免
      for (const { pattern, label } of MECHANISM_TOKENS) {
        pattern.lastIndex = 0
        for (const match of template.matchAll(pattern)) {
          offenders.push(`${relative}（模板）：${label} →「${match[0]}」`)
        }
      }
    }
    // 脚本侧：只查带汉字的产品语句（注释由 collectLiterals 逐字跳过；'outline.json' 这类逻辑常量不上屏，不进这一面）。
    const scriptStart = raw.indexOf('<script')
    if (scriptStart >= 0) {
      const script = raw.slice(scriptStart, raw.indexOf('</script>') + 9)
      for (const prose of collectLiterals(script).filter((text) => /[\u4e00-\u9fff]/u.test(text))) {
        for (const { pattern, label } of MECHANISM_TOKENS) {
          pattern.lastIndex = 0
          for (const match of prose.matchAll(pattern)) {
            offenders.push(`${relative}（脚本常驻句）：${label} →「${match[0]}」`)
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `机制细节回到常驻版面了：\n${offenders.join('\n')}`)

  // 正向：样板节真的用了「一句话＋细节折叠」这套落点（BackupSection 是工单点名的样板）。
  const backup = await readFile(join(settingsDir, 'BackupSection.vue'), 'utf-8')
  assert.match(backup, /<details class="nx-note-details">/u, '样板节没了「细节」折叠，口径就断了')
  // 正向：〔批次68-R4〕PrefsSection 的探测结果句真的走「模型服务」词表，不再把进程名甩给作者。
  const prefs = await readFile(join(settingsDir, 'PrefsSection.vue'), 'utf-8')
  assert.match(prefs, /检测模型服务/u, '「检测模型面」要改口成「检测模型服务」')
  assert.match(prefs, /模型服务不可达/u, '探测结果的常驻句要用同一个词表')
  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  assert.ok(layout.includes('.nx-note-details'), '「细节」折叠的样式落点要在布局层')
})

/**
 * 〔批次68-R6 门禁⑳〕右栏停靠占位化：Agent 坞是版面里的**占位兄弟列**，不是浮层。
 *
 * 工单口径：正文右缘的常驻控件（分页条／快捷词弹层／保存 chip）永远不许压在 Agent 面板上。
 * jsdom 量不了 rect，这一半归调度方真窗复拍；这里钉的是声明级链路——
 *   1) 绑定链：dockWidth ref → .col-dock 的 :style 宽度 → 拖拽闸 320..680 同一条 clamp；
 *   2) 排版：.col-dock 必须是 flex 占位项（0 0 auto）且**绝不**定位；
 *      .col-center 必须 min-width:0（长稿不许把坞顶出可视区）——占位化的另一半是「中心区可缩」；
 *   3) 正文右缘控件不借视口坐标：.nx-tools 绝对定位（锚在面板内的 relative 挂点），
 *      而不是 fixed；.chapter-pager 不领任何定位规则。
 * 浮层清单（哪些能盖内容、哪些必须留在自己栏内）见执行记录 §7-1 任务一的表——
 * 这一闸只钉「常驻／半常驻类不出栏」这条纪律的声明级样本，清单本身归人裁。
 */
test('〔批次68-R6 门禁⑳〕右栏是占位列：绑定链完整、坞不定位、中心区可缩、右缘控件不出栏', async () => {
  const app = stripComments(await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/gu, '')
  assert.match(app, /const dockWidth = ref\(\d+\)/u, '坞宽要有唯一的状态出处（dockWidth ref）')
  assert.match(app, /class="col-dock"[\s\S]{0,80}:style="\{ width: dockWidth \+ 'px' \}"/u, '.col-dock 的宽度必须绑在 dockWidth 上——拖拽与占位共用这一格数')
  assert.match(app, /dockWidth\.value = Math\.min\(680, Math\.max\(320, next\)\)/u, '拖拽闸的 320..680 clamp 要在（坞不许被拖成零宽或满屏）')

  const layout = stripComments(await readFile(join(shellDir, 'styles', 'next-shell.css'), 'utf-8'))
  const dockBody = ruleBody(layout, '.col-dock {')
  assert.ok(dockBody && /flex:\s*0 0 auto/.test(dockBody), '.col-dock 必须是 flex 占位项（0 0 auto）——不是占位就是浮层')
  assert.equal(/position:\s*(fixed|absolute)/.test(dockBody ?? ''), false, '坞本体绝不许定位：占位列靠排版活着')
  const centerBody = ruleBody(layout, '.col-center {')
  assert.ok(centerBody && /min-width:\s*0/.test(centerBody), '中心区缺 min-width:0：一条不折行的长稿就能把坞顶出可视区（占位化的一半是中心区可缩）')
  const dockInside = ruleBody(layout, '.dock {')
  assert.equal(/position:\s*(fixed|absolute)/.test(dockInside ?? ''), false, '对话框容器也不许定位')
  const toolsBody = ruleBody(layout, '.nx-tools {')
  assert.ok(toolsBody && /position:\s*absolute/.test(toolsBody), '快捷词弹层要绝对定位在面板内的挂点上——fixed 等于借视口坐标，会盖过坞')
  assert.equal(/position:\s*fixed/.test(toolsBody ?? ''), false, '正文右缘的常驻控件不许 fixed')
  const anchorBody = ruleBody(layout, '.nx-tools-anchor {')
  assert.ok(anchorBody && /position:\s*relative/.test(anchorBody), '弹层的挂点必须是 relative（absolute 有爹可认，才出不了栏）')
  const pagerBody = ruleBody(layout, '.chapter-pager {')
  assert.equal(/position:\s*(fixed|absolute)/.test(pagerBody ?? ''), false, '分页条是流内件：它可以有样式，但不许领定位规则')

  // 坞的兄弟关系钉在宿主结构里：col-center 与 col-dock 同排，中间只隔把手。
  const centerAt = app.indexOf('class="col-center"')
  const dockAt = app.indexOf('class="col-dock"')
  assert.ok(centerAt >= 0 && dockAt > centerAt, '右栏必须还是中心区的占位兄弟列——结构挪了就回到浮层老账')
  assert.ok(app.slice(centerAt, dockAt).includes('class="resizer"'), '两列之间只应隔一条拖拽把手（坞宽唯一入口还是那个拖拽）')
})

/**
 * 〔批次68-R6 门禁㉑〕正文默认实时编辑渲染：「编辑」钮退役，阅读面自己声明可点入。
 *
 * 两半判据（工单原文）：模板不再保留 chapter-edit 入口钮（保存 chip 与「取消」例外）；
 * 阅读面容器挂着「点入进编辑」的交互声明（data-click-to-edit），点击处理里那条
 * 「非蓝链 → enterChapterEditingFrom」的分支在，失焦与 Ctrl+S 收口走同一条 commit。
 */
test('〔批次68-R6 门禁㉑〕正文编辑入口是「点入即改」：chapter-edit 钮绝迹，阅读面挂交互声明', async () => {
  const carrier = stripComments(await readFile(join(shellDir, 'CarrierPaneHost.vue'), 'utf-8')).replace(/<!--[\s\S]*?-->/gu, '')
  assert.equal(carrier.includes('data-test="chapter-edit"'), false, '「编辑」入口钮退役了又回来')
  assert.equal(carrier.includes('class="control-secondary chapter-edit"'), false, 'chapter-edit 的控件词汇也该随钮一起退')
  // 例外两支保留：取消（编辑态退路）与保存 chip（状态读数）。
  assert.match(carrier, /data-test="chapter-cancel"/u, '「取消」不在退役面内：它是编辑态的退路')
  assert.match(carrier, /class="nx-save-chip"/u, '保存 chip 不在退役面内')
  // 交互声明：阅读面容器上钉着点入语义，判据看的是声明本身。
  assert.match(carrier, /data-test="chapter-rendered"[\s\S]{0,20}data-click-to-edit="chapter"/u, '阅读面容器没有「点入进编辑」的机器声明')
  // 分支在位：蓝链先吸掉，其余点击进就地接稿；就地接稿真的会点亮编辑态。
  assert.match(carrier, /function onChapterRenderedClick[\s\S]{0,900}enterChapterEditingFrom\(event\)/u, '点击处理没接上就地接稿（else 分支断了）')
  assert.match(carrier, /async function enterChapterEditingFrom[\s\S]{0,1200}chapterEditing\.value = true/u, '就地接稿不点亮编辑态就是假入口')
  // 收口两条都走同一份 commit：失焦与 Ctrl+S；展开走同一份 expandChapterForEditing（不长第二套）。
  assert.match(carrier, /function onEditorBlur[\s\S]{0,700}commitChapterEditing\(\)/u, '失焦没接保存回渲染态')
  assert.match(carrier, /onPaneKeydown[\s\S]{0,900}commitChapterEditing\(\)/u, '正文的 Ctrl+S 没接保存回渲染态')
  assert.match(carrier, /async function commitChapterEditing[\s\S]{0,700}await props\.data\.save\(\)[\s\S]{0,200}chapterEditing\.value = false/u, 'commit 必须保存后回渲染态（两步缺一步都不算「保存回渲染态」）')
  assert.match(carrier, /async function insertAtCaret[\s\S]{0,600}expandChapterForEditing\(\)/u, '快捷词／取名插入没走整章展开就落字：半截草稿上落字＝下一次保存抹掉后段')
  // 分页兼容：编辑态下分页条整块让位（v-if 谓词在），回到阅读态由 watch 现补当前页。
  assert.match(carrier, /v-if="!chapterEditing && textPagesReading && chapterPageCount > 1" class="chapter-pager"/u, '编辑态没让位分页条（「进入编辑自动整章展开」的版面前提）')
})

/**
 * 〔批次 M1-c〕推演面板的挂载点合同（工单交付物 1 + 6 的字面量同步）。
 *
 * 侦察结论：页态窗口由 workspace.entries／PaneWindow／PaneTabStrip／viewRegistry 数据驱动，
 * 新开页签会撞守卫⑪⑫⑬；宿主常驻面板（RuntimeDock／SettingsModal）本就由 AppNext 直接挂载。
 * M1-c 取最浅路径：`<DeducePanel>` 由 AppNext 直接挂在 .col-center 内，一枚标题栏开关 (v-if) 控制显隐，
 * 不注册页签／槽位／视图／IPC 通道；回执并入既有 serviceSnapshot，不建第二套通知 UI。
 * 这条把「直接挂载 + 不越界」钉成机器判据：改回页签注册或另起桥通道即红。
 */
test('〔批次 M1-c〕推演面板＝AppNext 直接挂载的中栏覆盖层：开关／回执／不新增页态与通道', async () => {
  const app = await readFile(join(shellDir, 'AppNext.vue'), 'utf-8')

  // ① 直接挂载的四个钉子：导入、v-if 显隐、world 书面条目同源、回执／关闭落点。
  assert.match(app, /import DeducePanel from '\.\/DeducePanel\.vue'/u, 'AppNext 没直接 import DeducePanel')
  assert.match(app, /<DeducePanel[\s\S]{0,160}v-if="deduceOpen"/u, '推演面板不是 AppNext 直挂的 v-if 覆盖层（别改回页签注册）')
  assert.match(app, /:entries="indexData\?\.entries\?\.length \? indexData\.entries : data\.entries"/u, '推演面板条目＝索引页实例优先、基座回落（d54aed3 修复接线：基座 data 不加载世界书文档）')
  assert.match(app, /@close="closeDeduce"/u, '关闭没接回 deduceOpen')
  assert.match(app, /@receipt="onDeduceReceipt"/u, '回执没接回宿主')
  assert.match(app, /const deduceOpen = ref\(false\)/u, '显隐状态不是 AppNext 自己那枚 ref')
  assert.match(app, /function toggleDeduce\(\)/u, '缺 toggleDeduce')
  assert.match(app, /function closeDeduce\(\)/u, '缺 closeDeduce')

  // ② 它挂在中栏 .col-center 内、在 CollapseOrb 之后，绝不塞进窗口层／页签条／槽位宿主。
  const colStart = app.indexOf('class="col-center"')
  const colEnd = app.indexOf('class="col-dock"', colStart)
  assert.ok(colStart >= 0 && colEnd > colStart, '找不到 .col-center 与 .col-dock 边界')
  const col = app.slice(colStart, colEnd)
  assert.ok(col.indexOf('deduceOpen') > col.indexOf('<CollapseOrb'), '推演层没挂在 .col-center 内、CollapseOrb 之后')

  // ③ 标题栏开关在 .nx-menubar（no-drag 区，真窗可点），且只用共享控件词汇 control-quiet。
  const menubarStart = app.indexOf('class="nx-menubar"')
  const menubar = app.slice(menubarStart, app.indexOf('</nav>', menubarStart))
  assert.match(menubar, /data-test="deduce-toggle"/u, '标题栏没有「推演」开关')
  assert.match(menubar, /class="control-quiet nx-deduce-toggle"/u, '开关没用共享控件词汇 control-quiet')
  assert.match(menubar, /@click="toggleDeduce"/u, '开关没接 toggleDeduce')

  // ④ 回执只并入既有 serviceSnapshot（服务与通知那份镜像），不建新通道、不碰桥。
  const receiptFn = (app.match(/function onDeduceReceipt\([\s\S]*?\n\}/u) ?? [])[0] ?? ''
  assert.ok(receiptFn, 'AppNext 未定义 onDeduceReceipt')
  assert.match(receiptFn, /serviceSnapshot\.value/u, '回执没并入既有 serviceSnapshot')
  assert.match(receiptFn, /entries:/u, '回执没落到 entries（另起了一套状态）')
  assert.equal(receiptFn.includes('bridge.request'), false, '推演回执不许新起一次桥调用')
  assert.equal(receiptFn.includes('IPC_CHANNELS'), false, '推演回执不许新添 IPC 通道')

  // ⑤ 老硬约束不回潮：中栏不走 CenterSlotHost、AppNext 不留 scoped 样式／localStorage／硬编码坐标。
  const clean = stripComments(app).replace(/<!--[\s\S]*?-->/gu, '')
  assert.equal(clean.includes('CenterSlotHost'), false, '中栏不允许回潮成旧单槽宿主')
  assert.equal(clean.includes('WorkbenchModal'), false, '推演面板不是设置弹窗，不许挂 WorkbenchModal')
  assert.equal(clean.includes('<style scoped>'), false, 'AppNext 不许为推演层加 scoped 样式块')
  assert.doesNotMatch(clean, /\.localStorage/u, '推演显隐不碰 localStorage')
  assert.doesNotMatch(clean, /(?:left|top|right)\s*:\s*['"]?\d+px/u, 'AppNext 不许写硬编码坐标')
})

/**
 * 〔批次 M1-c〕场景卡／徽章／双模式／第一视角两面板／留档的字面量同步（工单交付物 2/3/4 + 6）。
 *
 * 分工：deduce-panel.spec.mjs 在 jsdom 里验「跑起来那一面」，deduce-view.test.mjs 用 node:test 验纯封装；
 * 这条只钉「屏上写了什么、挂了什么钩子」——把新组件的字面量合同收进 visual-contract，
 * 免得以后改文案／撤钩子时没人拦。词表本体（三徽章／四字段／2d6）住在 fact 纯模块，一并核对在位。
 */
test('〔批次 M1-c〕推演场景卡字面量：四字段／三徽章／双模式／第一视角两面板／留档钩子齐', async () => {
  const panel = await readFile(join(shellDir, 'DeducePanel.vue'), 'utf-8')
  const template = stripComments(panel.slice(panel.indexOf('<template'), panel.lastIndexOf('</template>') + 11))
    .replace(/<!--[\s\S]*?-->/gu, '')

  // ① 局面卡：四字段由 view.fields 统一渲染（who/where/tension/hook 本体在 fact 封装里核）。
  assert.match(template, /data-test="deduce-scene-card"/u, '局面卡容器没挂 data-test')
  assert.match(template, /v-for="field in view\.fields"/u, '四字段没走 view.fields 统一渲染')
  assert.match(template, /:data-field="field\.key"/u, '字段没带 data-field 机器标识')

  // ② 徽章词表 + 候选列表：2–4 条、三来源图例、命运骰 2d6、候选带 data-source。
  assert.match(template, /data-test="deduce-badge-legend"/u, '徽章图例缺位')
  assert.match(template, /v-for="item in CANDIDATE_BADGES"/u, '图例没绑 fact 的徽章词表')
  assert.match(template, /候选 2[–-]4 条/u, '候选 2–4 条的声明没上屏')
  assert.match(template, /2d6/u, '命运骰 2d6 的声明没上屏')
  assert.match(template, /data-test="deduce-candidates"/u, '候选列表缺位')
  assert.match(template, /:data-source="option\.source"/u, '候选没带来源机器标识')

  // ③ 玩家／导演双模式：切换钮、玩家「选择」、导演否决／重掷／注入表单。
  assert.match(template, /data-test="deduce-mode-player"/u, '缺玩家模式切换钮')
  assert.match(template, /data-test="deduce-mode-director"/u, '缺导演模式切换钮')
  assert.match(template, /deduce-pick-\$\{option\.source\}/u, '玩家「选择」钮没按来源挂 data-test')
  assert.match(template, /data-test="deduce-reroll"/u, '导演重掷钮缺位')
  assert.match(template, /data-test="deduce-inject"/u, '导演注入表单缺位')
  assert.match(template, /class="control-quiet nx-deduce-veto"/u, '导演否决钮没用共享控件词汇')

  // ④ 第一视角两面板 + 回执 + 留档：已知情报／人物关系蓝链、本局回执、收束／中断快照。
  for (const hook of ['deduce-known', 'deduce-relations', 'deduce-receipts', 'deduce-archived', 'deduce-reopen', 'deduce-finish', 'deduce-interrupt']) {
    assert.match(template, new RegExp(`data-test="${hook}"`, 'u'), `缺 ${hook} 落点`)
  }
  assert.match(template, /class="workspace-nav-item nx-deduce-link"/u, '已知情报／关系蓝链没用共享导航行词汇')

  // ⑤ 新组件不破既有字面量合同：空态用「暂无」不撞四个词根、不上批次号／工程词、字号圆角走 token。
  assert.doesNotMatch(template, /还没有|没有内容|请从|请先/u, '空态撞了「还没有／请从」词根（门禁⑱会红）')
  assert.doesNotMatch(template, /批次\s*\d+|清单声明|工程覆盖|承载位|写族闸/u, '实现行话上了屏（门禁⑮会红）')
  const style = stripComments(panel.slice(panel.indexOf('<style'), panel.lastIndexOf('</style>') + 8))
  assert.doesNotMatch(style, /(?:font-size|border-radius)\s*:\s*\d+(?:\.\d+)?px/u, '字号／圆角写了裸 px（刻度门禁会红）')
  assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/u, '样式里写了硬编码颜色')

  // ⑥ 词表本体在 fact 纯模块：三徽章字形 + 局面卡四字段 key（薄封装不许把词表埋回 SFC）。
  const view = await readFile(join(repoRoot, 'next', 'fact', 'usecases', 'deduce', 'deduceView.js'), 'utf-8')
  for (const glyph of ['▮', '⚙', '✦']) {
    assert.ok(view.includes(glyph), `fact 词表缺徽章字形 ${glyph}`)
  }
  for (const key of ['who', 'where', 'tension', 'hook']) {
    assert.match(view, new RegExp(`key: '${key}'`, 'u'), `fact 词表缺局面卡字段 ${key}`)
  }
  assert.match(view, /2d6 /u, 'fact 词表缺命运骰 2d6 trace 文案')
})
