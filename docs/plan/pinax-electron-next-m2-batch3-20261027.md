# Pinax-Electron-Next · M2 批次 3 验收记录（2026-10-27）

> 上位文档：[规范 v1](./pinax-electron-next-spec-20261027.md)、[M1 验收记录](./pinax-electron-next-m1-acceptance-20261027.md)、[M2 批次 1](./pinax-electron-next-m2-batch1-20261027.md)、[M2 批次 2](./pinax-electron-next-m2-batch2-20261027.md)。
> 本批的起因是作者一句话：「这个前端也太糟糕了，我们整体还是要再原本的前端审美一致性上添加功能，包括按钮和风格的复用」。
> 本档只记「跑出来什么、数字多少、哪些没覆盖」。所有数字来自今天本机工作副本的实测，按第 4 节命令可复现。

## 0. 结论先行

**本批把 Next 外壳的视觉层从「自己另写一套」改成「直接引老前端那几份 CSS 的本体」，并给这件事上了 8 条机读门禁。** 关键选择是**引本体而不是拷一份**：改了 `src/styles/` 里的 token，Next 外壳跟着变——否则「复用」只是「长得像」，作者改一次主题就要改两处地方。

具体落法有四块：

1. **复用缝**：`next/shell/styles/legacy.mjs`（16 行）按老前端 `src/main.js:9-13` 的原始顺序引三份本体——`src/styles/main.css`、`src/styles/themes/legacy.css`、`src/styles/workbench-controls.css`——再接 Next 自己的 `next-shell.css`。Next 目录里**没有**任何 CSS 拷贝，门禁第 5 条就钉着这件事。
2. **只新造两个原语**。原版已有 `.control-*` 这一套按钮词汇（`workbench-controls.css`），所以 Next **没有**新造按钮：命令型按钮一律落 `.control-primary`／`.control-secondary`／`.control-quiet`／`.control-toggle`／`.control-danger`。Next 只补了原版缺的两样：`.nx-row`（行按钮，选它＝看它，不是命令，`next-shell.css:36`）和 `.nx-field`（输入框，对齐原版 `workspace-surfaces.css:3-11` 的输入框写法，`next-shell.css:73`）。行按钮必须另立，因为 `.control-*` 是 999px 药丸，做成导航行会失掉原版的形状语言。
3. **主题契约照抄**：`next/shell/theme.mjs` 不引 pinia，直接复刻 `src/stores/themeStore.js` 的合同——localStorage 键 `app_theme`（`themeStore.js:5`）、`<html>` 挂 `theme-legacy` + `theme-light|theme-dark`（`themeStore.js:78-81`）、默认亮色。左栏底部加了一个 `深色模式` 开关，走 `.control-toggle`＋`aria-pressed`。
4. **8 条新门禁**：6 条 node:test（`next/tests/visual-contract.test.mjs`，新增文件）、1 条 shell 合同改严（渲染层薄门禁改成递归扫描＋只放行 `src/styles/*.css` 的洗白名单）、2 条打包门禁（h/i）。

`npm run verify:next` 五段全绿：真载体＋空框架混合验收 **16/16**、内核单测 **112/112**（新增 7 条视觉判据）、外壳界面测 **21/21**、`eslint next` 零告警、打包门禁 a–i 全过，exit 0。

本批还查出一处**功能缺口**：左竖条从来没有把「当前是哪块板」标出来——选中态比对的是 pane id，而默认落点是中栏 pane（`novel.editor`），跟竖条条目（`novel.shelf`）永远对不上，所以竖条一直是「全灭」的，看着像没有方向。这不是配色问题，是外壳自己漏了的一环，已修（`ActivityRail.vue:29-36`＋`AppNext.vue:45-46`）并补了回归测（`shell-ui.spec.mjs` 第 9 条）。

没做成的，如实记账：① **窗口仍然只是「截图看过」**，作者人在手机侧，真实桌面上没人用这窗口点过；② **一次真模型调用仍然没有**（批次 2 §5.1 原样欠着）；③ **四处口径仍待作者裁定**——明暗默认取哪个、首屏开哪块板、UI 缩放 0.85 继不继承、老版那两份 `.app-shell` 作用域样式要不要拆（第 5 节 1–4 条）；④ 老前端的 `workspace-navigation.css`／`workspace-surfaces.css` 因为作用域锁死在 `.theme-legacy .app-shell` 上，**没有**被引进来，Next 只能按原版度量自己复刻一份 42px 行高（`next-shell.css:21` 的注释记着出处 `src/styles/workspace-navigation.css:13`）——这是「引本体」这条路第一次撞到作用域墙。

---

## 1. 这一批交付的七块东西

**① 复用缝（新文件 `next/shell/styles/legacy.mjs`）。** 导入顺序与老前端一致（`src/main.js:9-13`：main → themes/legacy → experience-reading → workbench-controls → interface-language）。故意不引两份，各有理由：`experience-reading.css` 整份作用域在 `.theme-legacy .game-page .prose-reading-plane`（老前端的跑团阅读页排版，Next 用不到）；`interface-language.css` 只管 `:lang(en)` 的语种覆盖与旧页面选择器。Vite 的 CSS 管线会把 `url()` 里的 woff2 一起解析并打进产物（打包门禁 i 就是查这个）。

**② Next 自己的布局层（新文件 `next/shell/styles/next-shell.css`，651 行）。** 三栏骨架、行按钮、输入框、载体面板、运行时栏、外壳变量。**整份没有一个硬编码颜色**——门禁第 1 条扫十六进制／`rgb()`／`hsl()`／颜色关键字，只放行 `transparent`／`currentColor`／`inherit`；门禁第 2 条再反过来查每个 `var(--x)` 都有定义（写错 token 名会静默失效，这条专治这个）；门禁第 3 条规定 Next 只许定义 `--nx-*` 开头自己的变量，不许重定义老 token。选中色按老版的**两级**走：竖条上的当前板块用强选中色（`--workbench-selected`，对应 `ProjectWritingNavigation.vue:30`），清单里的当前行用次级选中色（7% 墨色叠导航面，对应 `workspace-surfaces.css:94`），两级的比例与基底都照抄老版公式。

**③ 五个 SFC 全部重写成原版词汇（新写／重写 `ActivityRail.vue`、`AppNext.vue`、`CenterSlotHost.vue`、`CarrierPaneHost.vue`、`RuntimeDock.vue`）。** 五个文件的 `<style scoped>` 全部删掉——留着一份 scoped 样式就等于留了一套私有的设计语言，和「复用」直接冲突。改完的形状：左栏激活项是 `.rail-item nx-row`＋`主` 徽章，载体面板按钮是 `.pane-btn control-quiet`／`.pane-btn is-primary control-primary`，运行时栏发送键是 `.dock-send control-primary`，外壳向导按钮是 `.wizard-item control-secondary`，深色开关是 `.control-toggle`。**所有原有 class 名一个没删**（`.entry-link`、`.editor-area`、`.dock-input`、`.shelf-new .pane-input` 等），因为既有测试是按 class 名选元素的，删名等于删测试。

**④ 主题契约（新文件 `next/shell/theme.mjs`，40 行）。** 不引 pinia（外壳渲染层本来就薄，不该为一个开关把状态库拖进来），逐条复刻 `src/stores/themeStore.js`：localStorage 键 `app_theme`、`<html>` 挂 `theme-legacy` 与 `theme-light|theme-dark`、默认亮色。渲染进程入口 `renderer.mjs` 在挂载前先 `applyScheme(readScheme())`，所以启动即是对的主题，不会有「先白后黑」的闪。

**⑤ 7 条视觉门禁（新文件 `next/tests/visual-contract.test.mjs`，187 行）。** 逐条判据：

| # | 判据 | 拦的是什么 |
| --- | --- | --- |
| 1 | Next 的样式里没有硬编码颜色，一律走老前端 token | 有人在新壳里手写 `#2b2b2b`，绕开主题 |
| 2 | 用到的每个 token 都有定义 | `var(--accent-bg)` 写错成 `--accnet-bg`，静默失效不报错 |
| 3 | Next 只许定义 `--nx-*` 自己的变量 | 借「布局变量」之名重定义老 token，把老前端顶掉 |
| 4 | 每个按钮都落在共享词汇里（原版 `.control-*` 或行按钮 `.nx-row`） | 又冒出一个自造的 `.my-btn` |
| 5 | 风格层引的是老前端 CSS 本体，且 Next 目录里没有拷贝 | 把 CSS 拷进 Next 目录，改一边忘了另一边 |
| 6 | 外壳根节点挂着 `theme-legacy` | 忘了挂 class，整套 token 失效还不报错 |
| 7 | 选中色分两级：清单行走次级选中，板块栏走强选中，且公式与老版同比例同基底 | 把两级压成一级，深色下变成一块死重的色板 |

第 7 条的判据是「同源」而不是「好看」：老版 `workspace-navigation.css:7-8` 的 hover 是 5% 墨色叠导航面、次级选中是 7%，Next 的 `--nx-nav-hover`／`--nx-nav-selected` 必须写成同样的比例、同样的基底（`--surface-workbench-muted` 就是老版的 `--nav-surface`）。门禁直接去老文件里把那两条正则抠出来对账，改一边另一边就会红。

**⑥ 渲染层薄门禁改严（改 `next/tests/shell-contract.test.mjs:186-215`）。** 原来只扫 `next/shell/` 一层且把任何 `../src/` 都当越界——复用缝正好撞在这条上。改法两步：扫描改成递归（否则 `next/shell/styles/legacy.mjs` 根本扫不到）；再给一条**只针对 CSS 的白名单**（`import … from '…/src/styles/*.css'` 先从文本里洗掉，再跑越界正则）。JS 侧的 `../src/` 仍然一律禁——渲染层不许引老前端的**代码**，只许引它的**样式**。

**⑦ 2 条打包门禁（改 `next/testing/bundleAssertions.mjs:136-153`）。** 因为源码里引了 CSS 不等于产物里真的有：门禁 h 查渲染层 CSS 里带没带老前端的控件词汇与 token（`--control-accent-bg`、`.control-primary`、`--radius-control`、`--workbench-action`、`--archive-ink`、`--font-writing`、`.theme-legacy.theme-dark`），门禁 i 查自托管的霞鹜文楷 woff2 有没有跟着进产物（不跟，标题会落回系统默认字体）。

**⑧ 竖条的当前板块标记（改 `next/shell/ActivityRail.vue:29-36`、`next/shell/AppNext.vue:45-46`）。** 选中态改成两种命中：竖条条目自己的 pane id（点它就是它），或者当前中栏那块 pane 所属的载体（中栏在正文里时，竖条上的「书稿」也得标成当前）。老版工程导航的当前项用强选中色（`ProjectWritingNavigation.vue:30`），清单行用次级选中色，两者在 Next 里一一对应。回归测在 `next/tests/shell-ui.spec.mjs`（第 9 条，21/21 里新增的一条）。

---

## 2. 实测数字

| 段 | 命令 | 结果 |
| --- | --- | --- |
| 验收（M1 ①–⑦ ＋ M2 ⑧–⑭） | `node next/testing/acceptance.mjs` | **16/16**（与批次 2 同）。新增的「渲染侧依赖必须薄」那条现在带 CSS 洗白名单，JS 越界仍拒 |
| 内核/合同单测 | `node --test "next/tests/*.test.mjs"` | **112/112**（批次 2 是 105，本批 ＋7，全在新文件 `next/tests/visual-contract.test.mjs`） |
| 外壳界面测 | `vitest run --config next/vitest.next.shell.config.mjs` | **21/21**（批次 2 是 20，本批 ＋1：竖条当前板块标记）。三个文件不变（`shell-ui` 9、`carrier-pane` 9、`carrier-pane-real` 3） |
| 源码 lint | `npm run lint:next` | 0 错 0 警（`--max-warnings 0`） |
| 打包门禁 | `node next/testing/bundleAssertions.mjs` | 全过：主进程 bundle **860.8 kB**（批次 2 是 861.2，－0.4）、渲染层 js **237.3 kB**（批次 2 是 235.1，＋2.2）、渲染层 CSS **70.3 kB**、霞鹜文楷 woff2 **607.10 kB**、产物内 express 命中 **0**、外部说明符 10 条全在 electron／`node:*`／原生模块白名单内、import 产物后 in-process 列出 **19** 工具 |
| 规模 | `next/` 源码（排除 `node_modules/.build`） | **72 文件 / 9226 行**（批次 2 是 67/8300）。按目录：`tests` 17/2953、`shell` 15/1873、`runtime` 9/963、`carriers` 7/944、`kernel` 7/901、`testing` 4/503、`project` 4/417、`fs` 3/384、根 6/288 |

**运行期实测（不是读源码，是浏览器里量出来的）：** 亮色下外壳底色 `rgb(243,243,242)`＝`--surface-workbench-muted`；主按钮 `rgb(48,50,56)` 文字 `rgb(255,255,255)`、999px 圆角＝`--workbench-action` ＋原版药丸半径；正文界面字体＝原版 `--font-interface` 栈；稿件画布＝原版 `--font-writing`（Menlo/Consolas 栈，与老前端 `AuthoringOutlinePanel.vue:182` 的 `15px/2 var(--font-writing)` 同源）；两级选中色实测与公式一致——竖条当前板块亮色 `rgb(226,227,226)`＝`--workbench-selected`、清单行亮色 `srgb(0.893,0.893,0.890)`＝7% 墨色叠 `#f3f3f2`；深色下竖条当前板块 `rgb(48,50,54)`＝`--workbench-selected` 的深色值 `#303236`、清单行 `srgb(0.164,0.168,0.176)`＝7% 叠 `#1b1c1e`。

---

## 3. 踩坑账（这一轮踩的、查清的）

1. **「深色下选中行是浅灰带」——不是代码 bug，是取证方法的 bug。** 现象：深色截图里选中章节行底色发浅。逐层排除：`getComputedStyle` 读到的 `--workbench-selected` 在深色下**确实是** `#303236`；唯一样式表命中规则是 `.nx-row.is-active{background:var(--workbench-selected)}`；产物 CSS 里明暗两个 token 块都在且深色块在后。定位到的真因是 `document.visibilityState === 'hidden'`——Electron 窗口被遮挡，Chromium 不跑 CSS transition，于是元素**保持上一帧的旧底色**，且 `document.getAnimations()` 返回空数组（过渡根本没启动，不是被冻在中途）。判定方法：页面里注入 `* { transition: none !important }` 后值立刻归位（深色 `rgb(48,50,54)`、浅色 `rgb(226,227,226)`）。**正确取证法**：先写 `localStorage.app_theme` 再 `Page.reload`（启动即定主题，不存在过渡），再 `Page.captureScreenshot`。老前端的 `.control-*` 同样是 `transition: background-color .15s`，所以主题切换时的 120ms 交叉淡入是原版语言，**没有改**。
2. **渲染层薄门禁差点把复用缝判成越界。** 新缝里的 `import '../../../src/styles/main.css'` 命中禁词 `\.\.\/\.\.\/src`。修法不是放宽禁词，是加一条只针对 CSS 的白名单把合法样式导入洗掉再匹配，并同时把扫描改成递归。
3. **`ELECTRON_RUN_AS_NODE=1` 在 agent 的 shell 里是继承的。** 直接 `electron` 启动会被当成 node 跑，进程秒退且退出码具有迷惑性。必须 `env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js <entry>`。
4. **不要用全屏 `CopyFromScreen` 当证据。** 它会把作者桌面上别的窗口（当时是游戏客户端）拍进去。取证走 CDP：`--remote-debugging-port` ＋ `Page.captureScreenshot`，只拍应用自己的合成层，不受遮挡影响。
5. **左竖条一直没标过「当前是哪块板」。** 选中态比对的是 pane id（`novel.shelf` 对 `novel.shelf`），而默认落点是中栏 pane（`novel.editor`），两个 id 永远对不上——竖条因此一直全灭，看着像没方向。这条是量出来的：`document.querySelectorAll('.rail-item')` 的 class 全是 `rail-item nx-row`，没有 `is-active`。修法是加一条「当前中栏那块 pane 属于哪个载体」的命中（`AppNext.vue` 传 `activePluginId`，`ActivityRail.vue` 的 `isActive()` 认两种命中），并补了回归测。
6. **「深色下选中行是浅灰带」追到底之后，发现真正该改的不是颜色而是层级。** 老版的选中色本来就分两级：工程导航的当前项用强色（`--workbench-selected`，`ProjectWritingNavigation.vue:30`），清单行用次级色（7% 墨色叠导航面，`workspace-surfaces.css:94`）。Next 原来一律用强色，于是深色下每个当前章节都是一块 `#303236` 的死板。改成两级后：竖条上的当前板块用强色（它是「现在在哪块板」），清单里的当前章节用次级色（它是「这一行」）。这条差异是有出处的，不是审美偏好。

---

## 4. 复现

```bash
npm run verify:next                                  # 五段全跑，exit 0
node next/testing/acceptance.mjs                      # 16/16
node --test next/tests/visual-contract.test.mjs      # 7/7
node --test "next/tests/*.test.mjs"                  # 112/112
npx vitest run --config next/vitest.next.shell.config.mjs   # 21/21
npm run lint:next                                    # 0 错 0 警
node next/testing/bundleAssertions.mjs               # 打包门禁 a–i
```

可视证据（本机预览目录，不在仓库内）：`D:\next-preview\shots\05-legacy-light.png`、`D:\next-preview\shots\06-legacy-dark.png`（明暗两套，均为「以该主题启动 → 截图」，不是切主题后截图）。

---

## 5. 未覆盖项与待裁定（逐条给去处）

1. **明暗默认取哪个。** 现在跟老前端一致，**默认亮色**（`theme.mjs:12` `DEFAULT_SCHEME = 'light'`，与 `themeStore.js` 同）。老前端把 `theme-legacy` 称作「唯一在用的产品主题」，且 `legacy.css` 的亮色是主色板。**待裁**：Next 作为 Electron 应用是否也应当默认亮色（我按「与老前端一致」实现），还是允许按系统偏好走 `prefers-color-scheme`。
2. **首屏开哪块板。** 现在左栏第一块是「书稿」（主载体），中间区默认解析到 `centerPanes[0]`，也就是正文那本「小说」板。「设定板」排在第二。**待裁**：以载体为第一公民（现在的做法），还是首屏给「设定板」。
3. **UI 缩放 0.85 没有继承。** 老前端的 `themeStore.js` 有一套全局 `zoom`＋`--app-viewport-height` 反补偿（那段注释记着「zoom 与 transform 会叠成 0.56」和浏览器 URL bar 适配）。Next 是 Electron 窗口，窗口本身就是视口，没有 URL bar，那套反补偿没有存在理由，硬搬过来只会让内容缩在中间。**待裁**：确认不继承；若作者想要放大观感，应该调 Next 自己的 `--nx-*` 尺寸变量，而不是把浏览器的 zoom 补丁搬进桌面端。
4. **老前端的 `workspace-navigation.css`／`workspace-surfaces.css` 没有被引。** 这两份整份作用域在 `.theme-legacy .app-shell`（老前端的 DOM 结构），Next 的根节点不是 `.app-shell`，引了也不生效。现在 Next 按原版度量自己复刻了行高（`next-shell.css:21` 注释记着 42px 的出处 `src/styles/workspace-navigation.css:13`）。**待裁**：是把这两份拆成可复用的片段（工作量大，属于结构性重构），还是继续让 Next 自己维护布局层、只复用 token 与控件词汇（现在的做法）。
5. **窗口仍然只是「截图看过」。** 作者人在手机侧，真实桌面上没人用这窗口点过一轮：鼠标悬停态、滚动、焦点环、真实点击的选中行为都只有静态截图与计算样式作证。**待裁**：要不要在作者方便时开一轮真机走查。
6. **一次真模型调用仍然没有**（批次 2 §5.1 原样欠着）。批次 4 的第一件实事应该还是它。
7. `next/carriers/.gitkeep` 残留与其配套的点文件过滤、Electron ABI 档／RAG 打包形态／CI 接线——三条与批次 1、2 同状态，本批未推进。

---

## 6. 批次 4 的入口（不在这批做）

先打真模型那一调并出证据（第 5 节第 6 条），这是「运行时能问」这句话第一次有机会被真正证明。同批把第 5 节第 1–4 条的作者裁决落进代码与门禁——尤其第 3 条：若确认不继承 zoom，就把「Next 不套用浏览器的 zoom 反补偿」写成显式条款钉住，免得下一批有人把 `themeStore.js` 那段搬过来。第 4 条若裁定要拆老版那两份 `.app-shell` 作用域样式，那是一次结构性重构，单独排一批，别混进功能批。设定板块的检索／关系图／大纲树排在它们后面——那是功能密度，不该插在口径没裁清的时候进来。夹具轨道仍然活着：`next/testing/fixtures.mjs` 与 `unclaimed 14` 同时被测试钉着。
