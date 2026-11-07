# 批次76-R3 执行记录：页签行归组（VS Code 编辑器组模型）（2026-11-05）

> 工单：[批次76-R3 工单](./pinax-electron-next-m2-batch76r3-ticket-20261105.md)。执行方=Qoder CLI；调度方=Zcode（§8 待补）。
> 本批性质＝**呈现层归属改写**：把 76-R2 那条「全屏合一条」改成「每组一条」。workspace v3 的状态轴语义（`form page｜floating｜tab`、`group main｜side`、`active`／`focus`／`order`／`z`、`maximized` 仍是浮窗子态）与 placement 数据形状**一字未改**；`PaneWindow.vue` 一行未动（允许清单里但本批不需要）。
> 作者那句裁定的落地：右半屏既然跟左边共用分屏，头顶就写它自己的窗口名——**孤零零空白半屏为违规态**，违规态由守卫⑬ 两头钉死（有窗必有签 / 有条无内容也不许）。

## §7-1 四条任务落点

**任务1 `PaneTabStrip` 拆组**——`group` 进 props（`PaneTabStrip.vue:29 group: { type: String, default: 'main' }`），根节点带 `:class="\`is-group-${group}\`"`（`:117`）＋ `:data-tabstrip-group="group"`（`:121`），`aria-label` 按组念「主组页签／侧组页签」；根上的 `v-if="pages.length || pendingPanes.length"`（`:115`）＝**空组连条都不出**。归属规则只有一条，写在宿主的数据层（不是渲染层临时拼）：

| 条 | 列谁 | 处 |
| --- | --- | --- |
| 主组条 | 本组的页（`form==='page' && group!=='side'`）在前，**没有页组归宿的那些**（浮窗、收进悬浮球的页）挂条尾 | `AppNext.vue:1419 mainStripPages` |
| 侧组条 | 只列 `form==='page' && group==='side'` 的页 | `AppNext.vue:1427 sideStripPages` |
| 两条共用的行末 | 76-R2 那批「待开签」仍挂**缺省开出的那一组**＝主组条尾（`pendingPanes` 只发给主组，侧组条给空数组） | `AppNext.vue:1503 pendingCenterPanes` ＋ `:1474/:1485` |

76-R2 的拖拽起点与点签判分（`PaneTabStrip.vue:65 onTabPointerDown` 只对 `form==='page'` 的签发 `drag`、4px 位移守卫压掉「拖完又发一次揭示」）原样保留——**只是归属从全局条改成组条**。组件被挂两次也不串味：`<script setup>` 的 `let draggedOnThisPress` 天生按实例各存一份。宿主页签行仍把 `pointerdown` 转进 `PaneWindow` 那句 `defineExpose({ startDrag })`（76-R2 的接线，吸附判定与预览仍是 `paneSnap.mjs` 那一份，没有第二套手势）。

**任务2 组签行几何**——每个页组一根列，列是 flex 列，**签行是列内首行**（不绝对定位、不浮叠）：`next-shell.css:969 .nx-pane-group { display:flex; flex-direction:column; flex:1 1 0; min-width:0; min-height:0 }`，两条并列自然各半＝原来的分屏，只剩一条就铺满。两条独立高亮：`AppNext.vue:1435 groupCurrentInstance(group)` 读的是 `workspaceSnapshot.active[group]`（浮窗／收起态没有页组归宿时，主组条才退而读 `focus` 那一格），焦点不在本组只把**底色**退一档（`:978 .is-blurred-group` 换 `--nx-tabstrip-surface`，走 `color-mix` 于既有 token，不新开色值），高亮照旧亮自己那组的页——**互不抢**。侧组条带 76-R2 同款左缘分隔（`:1285 .nx-page-tabstrip.is-group-side { border-left: 1px solid var(--hairline-soft) }`），分界从签行续到窗体（`.nx-pane-window.is-page.is-in-side` 那条原有）。

**两处非显然的取舍**（都是为了不动状态轴）：
1. 浮窗那一列（`:981 .is-overlay-group`＝`position:absolute; inset:0; pointer-events:none`）只是**容器**，不出条——浮窗的签归主组条尾收留，窗头仍是 76-R2 定的那一行。列盒＝窗层盒，所以浮窗几何读数一字未变。
2. 页组列**故意不给 `position`**：`PaneWindow.parentRect()` 量的是 `offsetParent`，一给列定位，拖拽吸附的「层」就缩水成半个屏，守卫④ 的分界跟着改判。这条被视觉契约正向钉住（见 §7-4）。吃回来的指针在基座规则 `.nx-pane-window { pointer-events: auto }` 上——**故意不写成复合选择器**，因为 `ruleBody()` 取的是第一条字面命中，复合选择器会把「窗口是绝对定位卡片」那条判据带偏。

**任务3 违规态消除**——`centerGroups`（`AppNext.vue:1461`）是唯一决定「屏上有几列、每列有没有条」的地方：主组列出场条件＝`mainWindow || mainStripPages.length || pending.length`（三者皆无就连列带条不出）；侧组列**只在侧组真摊着页时**出场（`if (sideWindow)`），于是「有窗无签」与「有条无内容」这两个方向同时被封。全局那一条的三个残留都清了：横跨整屏的 `<PaneTabStrip>` 挂载块、数据源 `tabStripPages`、高亮源 `const currentInstance = computed`（留任何一处就是第二本账，测试反向钉零命中）。页态高度链补了两环（`:1003 .nx-pane-window.is-page` 加 `min-height:0`——页态现在是列的子项，缺它就等于「内容多长窗多高」，长稿撑破整列）。

**任务4 回归**——批次61/66/76-R2 的页签用例按组模型改写但**行为语义一条未删**：`shell-ui.spec.mjs:1573`（待开签换核心区）、`:3532`（开窗缺省＝切页，页签列＝本组全部页）、`:3562`（切板不碰别的页／点页签＝揭示）、`:3896`（页签上的 ×＝删记录）四处从「屏上随便哪一条」改成**指名读 `data-tabstrip-group="main"`**，并各自加一条「此刻不该有第二条」的条数断言（归组后不许含糊通过）。守卫⑪ 的 ⑥ 块（`visual-contract.test.mjs:1013`）判据换到组模型等价物：`<PaneTabStrip` 站点恰好 **1** 处（组内 v-for，防「全局一条＋组内各一条」回潮）、`v-for="grp in centerGroups"`／`class="nx-pane-group"`／`:data-pane-group="grp.id"`／`const centerGroups = computed` 在册、`:group="grp.id"` 必须接线、`tabStripPages` 零命中。分组后的新语义「揭示另一组页＝把焦点给那组」由 `revealPage` 那一句 `hostWorkspace.setActive(entry.group, instance)`（`AppNext.vue:1710`，它同时落 `focus`）单独承担，用例 ④ 正向钉：点侧组签 → `snapshot().focus === 'side'`，形态与页组都不动（不搬家）。

## §7-2 越界补登记

工单「允许文件」清单（`PaneTabStrip.vue`／`AppNext.vue`／`PaneWindow.vue`／`styles/next-shell.css`／`next/tests/**`）之外：

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `docs/plan/pinax-electron-next-m2-batch76r3-20261105.md` | **本文件（新建）** | 工单§验收判据指定的批次记录落盘处，属登记动作本身 |
| `docs/STATUS.md` | **未动** | 不在允许清单内。按 `docs-status-handoff` 该由调度方在收口时落「76-R3 已交付＋第五段待清锁重跑」；此处登记，不越界代写 |
| `next/shell/PaneWindow.vue` | 允许但**零改动** | 页态无窗头／`startDrag` 暴露都是 76-R2 已落地的形状，本批只改「签行归谁」 |
| `next/testing/bundleAssertions.mjs`、`next/vite.next.main.config.mjs` | **未动**（本批第五段的堵处，见 §7-6-1） | 批次66 已登记同类结构性欠账（`emptyOutDir` ＋ 先 `rm` 后 `cp` 在 Windows 上撞占用）；根治涉及门禁脚本与 vite 配置，两样都不在允许清单，登记不扩 |

## §7-3 记账指标（不进闸）

**① 组签行数 ↔ 页数对照表**（`mainStripPages`／`sideStripPages`／`centerGroups` 的判定实况；「收留」＝浮窗与收进悬浮球的页挂主组条尾）：

| 屏上形态 | 组列数 | 主组条 | 侧组条 | 签数 |
| --- | --- | --- | --- | --- |
| 只有一页（main） | 1 | 1 条 | 不渲染（空组整列不出） | 主 1 |
| 对半双页（main＋side） | 2（＋浮窗列若有） | 1 条 | 1 条 | 主 1／侧 1 |
| **侧组只有一页**（作者裁定那句「右半必须显示窗口名」） | 2 | — | **1 条照常渲染**（单签也是条） | 侧 1 |
| 主组 1 页＋浮窗 1＋收起 1 | 2（主、侧无 → 浮窗列另计） | 1 条 | 不渲染 | 主 3（本组的页在前，收留的挂尾） |
| 一块板声明 k 面中栏、只开出 1 面 | 1 | 1 条 | 不渲染 | 主 1 ＋虚线待开 k−1 枚（条尾） |
| 全部页收进悬浮球（无摊开的页） | 1 | 1 条（签＝收起态页，仍可点回） | 不渲染 | 主 =收起数 |
| 一屏无页 | 0 | 不出条，改一行 `center-empty` 文案 | 不渲染 | 0 |
| 只有浮窗（无页态窗） | 1（浮窗列） | 主组条件含「条尾有收留的」→ 主组那条照常出，签＝浮窗 | 不渲染 | 主 =浮窗数 |

用例实测量到的是行 2 那一档（4 条 v3 记录 → 列 `['main','side','floating']`、条 2 条、主 3 签／侧 1 签）与行 1 那一档（单页 → 列只有 `['main']`）。

**② 旧全局条删除的代码量**（按块计；**未跑 `git diff`——工单禁 git**，故为改写时所见原块的行数目测，误差 ±3）：

| 撤掉的对象 | 约行数 | 反向钉 |
| --- | --- | --- |
| AppNext 模板里横跨整屏那段 `<PaneTabStrip …>` 挂载块（含 props 五行） | ≈ 11 | `<PaneTabStrip` 站点数恰好 1（在组内 v-for 里） |
| `const tabStripPages = computed(…)`（列全部页那本账） | ≈ 9 | `app.includes('tabStripPages') === false` |
| `const currentInstance = computed(…)`（全局那一份高亮） | ≈ 4 | `const currentInstance = computed` 零命中 |
| 合计 | **≈ 24** | — |
| 换上来的（组归属＋组列装配） | `stripRowOf`/`mainStripPages`/`sideStripPages`/`groupCurrentInstance`/`centerEmptyNote`/`centerGroups` 六段 89 行，加模板列壳 20 行、CSS 三则 17 行 | 只加不减的判据在 §7-4 |

同屏 chrome 行数与 76-R2 持平（页态 1 行），本批改的是**那一行的归属**：从「一条说自己家的话」改成「每条只说自己组的话」。

## §7-4 新增机器判据（只加条，未放宽任何既有条）

`next/tests/visual-contract.test.mjs`（声明级）：

- **守卫⑬**（新增 `test:1118`）：① `group` 必须是条的属性、DOM 须留 `data-tabstrip-group` 与 `is-group-${group}`；② 归属规则两条 filter 逐字命中（侧组＝本组的页；主组收留无归宿的），且主组条的**序**被钉（`[...pages, ...orphans]`）；③ 空组不出条（`if (sideWindow) { groups.push({` 与主组那三条并列的出场条件）；④ 高亮各读各组的 `snap.active[group]`，全局那份 `currentInstance` 必须零命中；⑤ 条在列内且列只有一个渲染站点（`markup.indexOf('<PaneTabStrip') < markup.indexOf('<PaneWindow')`）。
- **守卫⑪ 的 ⑥ 块**（`test:1013` 内，**判据换落点、方向和数量只增不减**）：新增「`<PaneTabStrip` 站点 === 1」「`:group="grp.id"` 接线」「`centerGroups`／`nx-pane-group`／`data-pane-group` 在册」「`tabStripPages` 零命中」，CSS 侧新增 `.nx-pane-group` 三则与 `.nx-page-tabstrip.is-group-side` 在册；并新增一条**结构性反向钉**——`.nx-pane-group` 规则体内不许出现 `position:`（一旦给列定位，吸附的「层」缩水成半屏，守卫④ 改判）。
- **守卫⑫**（`test:1041` 的 `chain` 表）：链首**加两环**（`.nx-pane-group`、`.nx-pane-window.is-page`），原有六环一字未动；`leaf` 旗标的含义在注释里写清（＝「只当 flex 子项，不要求自己声明 `display:flex`」，页态窗那句在基座规则上）。

`next/tests/shell-ui.spec.mjs`（运行时）：

- 守卫⑬ 的运行时那一半（`it:4110`＋公用 `expectEveryPageHasItsGroupTab`，`4091`）：屏上每摊开一页，`win.element.closest('[data-pane-group]')` 必须落在**本组那一列**，那列的 `firstElementChild` 必须是本组那条 `data-tabstrip-group=<组>` 的签行，且行内就有这一页的签；反向半条：侧组条存在 ⟺ 侧组有摊开的页（「有条无内容」同为违规）。jsdom 没有排版，所以「签行画在窗上方」这件事按 **DOM 归属**判——真机半屏复拍归调度方（§7-6-1）。
- 该用例还钉：列序 `['main','side','floating']`、条数恰 2、浮窗列不许自己长条款、两组 `is-active` 各亮各的、`is-blurred-group` 只落在非焦点那一组、点侧组签＝切焦点不搬家、条尾收留的浮窗与收起态各按原语义点回（浮窗＝抬前不改形态，收起＝按 `restore` 放回）。

## §7-5 门禁读数表

| 段 | 本批前 | 本批后 |
| --- | --- | --- |
| 验收 `next/testing/acceptance.mjs` | 44/44 | **44/44** |
| 内核 `node --test next/tests/*.test.mjs` | 817/817 | **818/818**（＋守卫⑬ 声明级 1 条） |
| 界面 `vitest run --config next/vitest.next.shell.config.mjs` | 237/237（15 文件） | **238/238（15 文件）**（＋守卫⑬ 运行时 1 条；另 4 条既有用例改按组模型指名，条数不变） |
| eslint `next --ext .mjs,.vue --max-warnings 0` | 0 警 | **0 警** |
| 打包 `node next/testing/bundleAssertions.mjs` | 全过 | **未跑通＝环境占用，非本轮改动**（`npm run verify:next` exit 1；诊断见 §7-6-1） |

三条只增不减：＋1 内核、＋1 界面、验收条数不变。第五段 `verify:next` 里 `exit≠0`，DoD「五段全绿」**本会话未达到**，堵因与解法如实登记如下，不冒充绿。

## §7-6 limitations（做不到的写在这里）

1. **第五段被在跑的实例锁住（唯一未达 DoD 的点）**。`bundleAssertions.mjs:82` 的主进程构建带着 `vite.next.main.config.mjs:16 emptyOutDir: true`，vite 要先清空 `next/.build`，`rmSync` 撞在 `next\.build\next` 上抛 `EPERM (syscall: rm)`。逐子目录改名探针：`carriers` **★改名被拒（被占住）**，`fs`／`kernel`／`project`／`runtime` 均可改名；持锁者是活着的 `node …\next\.build\next\carriers\comic\comfy-mcp-bridge.mjs`（PID 46312，由在跑的 `electron … next/.build/pinax-next-shell-main.mjs`（PID 28764）拉起）。工单明令**不启动/不杀进程**，故未清锁、未复跑。
   **与本轮改动无关的证据**（同一棵树、临时改写 outDir，跑完即删）：主进程构建 `--outDir next/.build-probe-main` 编译通过（631 modules，`pinax-next-main.mjs` 1680.13 kB，体积断言上限 6 MB 内）；吃本轮 `AppNext.vue`／`next-shell.css` 的**渲染层构建原地通过**（1708 modules，index css 208.70 kB／js 1271.10 kB，正是断言 f／f2 读的那份产物）。解法二选一，都要作者点头：**关掉在跑的 Pinax-Next 实例**后我单跑 `npm run next:bundle` 补齐第五段，或授权调度方在 CI／干净机上跑（批次66 已登记过同一类 Windows 占用欠账）。
2. **未真机复核**：本会话不启动/不杀 Electron，故没有「对半双嵌下两条组签行各自可见、右半头顶列『ComfyUI』、左半列『Toonflow』、两组高亮互不干扰」的实拍证据——守卫⑬ 只到 DOM 归属与声明链，`clientHeight`／条行实际像素归调度方复拍。视觉按 `ui-style-check` §6.2 记 **visuals unverified**。
3. **未 commit**（作者纪律，由 Zcode 统一提交）；全程未执行任何 git 命令，§7-3 的行数因此是「按块目测±3」而非 diff 实测。
4. `ui-style-check`／`testing-verification` 在本会话的 Skill 清单里没有注册（它们是 `agent-skills/` 下的 canonical 项），故按两份 SKILL.md 的清单**手工执行**：改动只用既有 token（`--hairline-soft`／`--surface-workbench-muted`，`color-mix` 沿用本文件既有用法）、不新增色值、不新增断点、不引 emoji／装饰性分隔线；新交互（组条高亮）配了 UI 用例。**未跑 `verify:full`**——工单指定 `verify:next`，且 `testing-verification` 的 20 文件／200 用例预算针对核心套件；本批所在的 next 轨界面套件是 15 文件／238 用例（本批前 237，属既有超限状态，未新增数值线，登记待处置）。
5. 待开签只挂**主组**条尾（缺省开出的那一组），没有做「作者把待开面挂到他正在看的那一组」这一层——VS Code 的新编辑器在「哪个组」有独立规则，本批沿用 76-R2 的缺省语义，等实拍反馈再定是否跟焦点组走。
6. 浮窗那一列是**纯容器**（不出条、`pointer-events:none` 由窗体自己吃回来），所以「浮窗也上签」这件事在 DOM 上表现为「主组条尾的签」，与 VS Code「浮窗不属于任何组」的观感一致；但**多个浮窗叠在一起时的层序视觉**沿用 `z` 轴原样，本批未动（禁边界）。
7. 「揭示另一组页＝把焦点给那组」只改了**焦点**，没有引入 VS Code 的「拖签到另一组＝换组」以外的新落点：拖签仍是守卫④ 那四个吸附靶（左／右／顶／球），阈值与判定都在 `paneSnap.mjs`，本批一字未动（不自设阈值当闸）。

---

## §8 调度方验收（Zcode · 2026-11-06）

**判定：通过（含调度方补刀）。** 执行方交付门禁独立复跑 exit 0（44/44 · 818/818 · 238/238 · eslint 0 · 打包过）；diff 评审：组分流（页态按组、浮窗/收起态收留主组条尾、空侧组整列不渲染）与「各亮各组」实现干净，守卫⑬在册。

### §8-1 真窗实拍发现、调度方补刀（四处）

实拍 `next-batch65a-shots/png/142` 结构正确（两条组签行、各亮各组），但签行手感违背作者原诉求「右半要显示它是谁」：

1. **签名截断吃掉了能区分的那半**：同一插件两面都以插件名开头，「Toonflow ＋ ComfyUI · ComfyUI」被整串截成「Toonflow ＋ ComfyUI · C…」。补刀：`windowTitleParts` 拆 head/tail 两段（整串仍只在 `windowTitle` 一处拼，裁定A 合同 `${carrierName} · ${label}` 字面量原样保留——首轮改动碰红了 visual-contract「批次33 文档头归一」，按合同改回代码而非改测试）；签上载体名先省略、文档名不参与收缩（首版用 flex-shrink 100:1 仍有亚像素溢出出省略号，改为 tail `flex:none`＋`max-width` 上限）。
2. **签宽改 IDE「fit」档**：原 `flex: 0 1 200px` 浏览器式挤扁，半屏七枚签全成「小..00…」残桩；改 `flex:none; max-width:240px`，装不下整条横滚。
3. **滚动条藏起＋滚轮横滚＋当前签滚入视野**：粗滚动条撤（`scrollbar-width:none`），竖滚轮在签行上换横滚（不溢出不吞滚轮），当前签在「切页／签列／签名变化」时自动 `scrollIntoView`（签名异步补全会把当前签挤出视野，只盯切页不够）。
4. 分隔符 ` · ` 作为 flex 项首尾空白被吞，补 `white-space:pre`。

补刀用例 `next/tests/pane-tabstrip.spec.mjs` ＋3（两段签名逐字合拼、未拆段照旧、溢出才吞滚轮）。补刀后门禁：44/44 · 818/818 · **241/241** · eslint 0 · 打包过。

### §8-2 真窗复拍（守卫⑬真机证据）

`144-b76r3b-tab-labels.png`／`145-b76r3b-full.png`：主组当前签「Toonflow ＋ Co… · Toonflow 画布」在视野内、文档名完整；侧组「Toonflow ＋ ComfyUI · ComfyUI」完整；无滚动条杠（strip offsetHeight−clientHeight＝1＝底边线）。

### §8-3 验收中发现的既有问题（非本批引入，另案）

- **ComfyUI 从未在 Pinax 窗内渲染**：ComfyUI 0.39 核心 `server.py:204 create_origin_only_middleware` 对 `Sec-Fetch-Site: cross-site` 一律空体 403；渲染层嵌 iframe 的导航天然是 cross-site。宿主侧放行技术上可行（主进程对已声明回环 app 窗的 subFrame 导航改写该头），但会使 ComfyUI 原生「运行」按钮在 Pinax 内可用＝**CF2TF 红线1「禁止第二个提交方直连 ComfyUI」**——提请作者裁定，未动。
- Toonflow :3010 服务当前未运行（环境，非代码）。

### §8-4 另案收口（作者 2026-11-07 裁定：豁免红线1——仅限本链路）

ComfyUI 从未在窗内渲染的根因＝ComfyUI 0.39 `server.py` 的 `origin_only_middleware` 对 iframe 导航的 `Sec-Fetch-Site: cross-site` 一律空体 403。作者裁定放行原生界面后落地：

- **新模块 `next/shell/appOriginHeaders.mjs`**（纯函数＋Electron 接线）：`collectAppOrigins`（清单顶层 panes＋contributes.panes 两形状、清单 app.url＋工程覆盖 url 两来源，只收本机回环）＋`rewriteAppOriginHeaders`（命中名单且 cross-site 才把这一个头改成 same-origin，其余头原样）＋`installAppOriginHeaderRewrite`（挂 defaultSession webRequest，filter 只圈回环；名单算不出来按不放行走并记 stderr）。三件闸：名单制／回环制／单头制。诊断口 `PINAX_DEBUG_APP_ORIGIN=1` 打判定流水（生产零输出）。
- **主进程接线**：`shell/main.mjs` createWindow 后对 `window_.webContents.session` 安装；来源＝`registry.list()`（归一清单）＋`readCarrierOverridesSync(session.projectRoot)`。
- **测试**：`next/tests/app-origin-headers.test.mjs` ＋4（名单去重与两来源／非回环与 file: 与内网全拒／单头改写其余原样／未声明与 same-origin 与空名单一律不动）。
- **真窗验证**：截图 `147-comfyui-native-live.png`——ComfyUI 原生界面（工作流画布＋「运行」钮＋显存读数）在 Pinax 内完整渲染；诊断流水：首航 `rewritten=true`，子资源改写后天然 same-origin。剩余 404 为 ComfyUI 可选 userdata 端点常态探测，无害。
- 调试坑存档：①`npm run build:next` 不存在（真名 `next:build:main`／`next:build:shell`／`next:build:renderer`），选择选择性构建会踩 A2 旧患（emptyOutDir 抹 renderer）；②归一清单 `panes` 在顶层不在 `contributes` 下——collectAppOrigins 首版因此空名单，已兼容两形状。
- 豁免边界重申：本链路只对「清单声明＋工程覆盖」的本机回环 origin 生效；CF2TF 自身 queue gate 纪律不变（其 SPEC §1.1 的提交通路归底座条款未触碰）。

### §8-5 调度方补刀（2026-11-07 · 盘点后的 bug 修复批）

按作者指令「先把 bug 全部修一遍」，可修四项（A4/A5/A7/A8/A12/A13/A15 卡作者裁定不修，A3 归批次78 基建债，A9/A14 低风险留账）：

- **A10 术语残留**：StatusBar/hotkeys/openTarget/workspace 六处「侧缘标签」→「收进悬浮球」（批次76 裁定B 后的旧词清零）。
- **A16 构建别名**：`npm run build:next`＝renderer→main→shell→next:bundle 一条龙（原脚本名不存在，选择性构建必踩 A2）。
- **A2 根治**：`vite.next.main.config.mjs` `emptyOutDir:false`（整目录抹掉曾带走门禁刚拷的 skills/ 与 renderer 产物＝「首跑红重跑绿」；陈旧产物由 next:bundle 断言把关），验证：build:next 单发即可用，renderer-next/index.html＋skills 同时在。
- **A1 测试残壳**：shell-ui.spec 本地 mount 进台账（129 处调用点零改动）＋文件级 afterEach 统一回卷——中途抛错用例的 document 级 keydown 不再替后续用例跑 collapseTopWindow。

门禁：44/44 · 822/822 · 241/241 · eslint 0 · 打包过；产物已重编并拉起（作者试用装）。
