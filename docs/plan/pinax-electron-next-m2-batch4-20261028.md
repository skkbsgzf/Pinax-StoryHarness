# Pinax-Electron-Next · M2 批次 4 验收记录（2026-10-28）

> 上位文档：[规范 v1](./pinax-electron-next-spec-20261027.md)、[M1 验收记录](./pinax-electron-next-m1-acceptance-20261027.md)、[M2 批次 1](./pinax-electron-next-m2-batch1-20261027.md)、[批次 2](./pinax-electron-next-m2-batch2-20261027.md)、[批次 3](./pinax-electron-next-m2-batch3-20261027.md)。
> 本批的起因是作者对着一张截图说的一句话：「你似乎完全没有去读我最开始的设计文档……在新的设计框架下，是基于 Obsidian 的三栏式去设计的……中间核心区：最为核心的部分是用来呈现正文的。你现在就是把正文挤在一些其他的功能页面旁边，这非常不利于阅读。」外加一条复用口径：「之前的 pinax 代码……在动效设计、CSS 选取以及组件上，很多能复用之前的，我觉得尽可能复用之前的，不是所有的部分都需要重新开发」。
> 本档只记「跑出来什么、数字多少、哪些没覆盖」。所有数字来自今天本机工作副本的实测，按第 4 节命令可复现。

## 0. 结论先行

**本批把 Next 外壳从「一个 208px 的文字竖条＋正文被挤在中间」重排成作者要的三栏：`44px 图标竖条 → 索引窗（200–360）→ 核心区＝正文 → 右栏运行时`，并第一次真正把老前端那两份被作用域锁死的样式表「引本体」用上。**

四个落法：

1. **一根竖条＝一块板（一个载体）**。竖条纯图标、44px，点它右边开出索引窗，再点同一格索引窗收起（Obsidian 的行为）。板块的图标取自载体清单里 pane 声明的 `icon` 原话，不另造。
2. **核心区只挂 `center` 槽的面板**。这是「正文被挤到旁边」的病根：老实现里 `CenterSlotHost` 渲染的是 `activePane`，而 `activePane` 可能是一块 `left-dock` 的面板（设定板），一渲染就把正文挤走。现在核心区只放这块板的 center 面板，正文占住中间那一栏。
3. **索引窗与核心区共用一份数据**。新文件 `next/shell/useBoardData.mjs` 用一个 `reactive` 对象持有章节／条目：索引窗列它、核心区写它。若分成两份，「索引窗写着第 1 版、正文存成了第 2 版」这种不同步必然发生。
4. **老前端那两份 CSS 从「抄一份」变成「引本体」。** 批次 3 §5 第 4 条记着：`workspace-navigation.css`／`workspace-surfaces.css` 整份作用域锁在 `.theme-legacy .app-shell` 上，Next 引了也不生效，只能自己复刻 42px 行高。本批把外壳根节点挂上 `app-shell` class（`<html class="theme-legacy theme-light">` ＋ `<div class="next-shell app-shell">`），祖先链一成立，那两份 CSS 的规则**原样生效**——实测行高 36px（老件 `--tree` 档）、字号 14px、当前行底色 `srgb(0.910,0.910,0.907)`＝5% 墨色叠导航面，与老件公式逐位对得上。Next 自己的布局层因此删掉了抄来的 `--nx-nav-hover`／`--nx-nav-selected`，一个 `--nav-*` 都不再定义（门禁钉着）。

`npm run verify:next` 五段全绿：真载体＋空框架混合验收 **16/16**、内核单测 **116/116**（批次 3 是 112，＋4）、外壳界面测 **25/25**（批次 3 是 21，＋4）、`eslint next` 零告警、打包门禁 a–i 全过，exit 0。

作者的 ①（顶部功能选项）也落地了：应用菜单补了 `设置` 顶层菜单（`切换明暗主题`／`偏好与模型…`），主进程真起一次外壳打印出来的标题是 `文件 / 编辑 / 视图 / 运行时 / 窗口 / 设置 / 帮助`，`设置 → 切换明暗主题` 那条点击经 `IPC_EVENT.menuInvoked` 落到外壳换主题（补了回归测）。

没做成的，如实记账：① **窗口仍然只是「截图看过」**，作者人在手机侧，真实桌面上没人用这窗口点过一轮；② **一次真模型调用仍然没有**（批次 2 §5.1 原样欠着）；③ **索引窗里只有两类树**（正文章节、世界书条目），固化骨架里的 `大纲/构思/资料/日志/约束` 目前只是静态清单行，还没有各自的树与工具；④ **四处口径仍待作者裁定**（明暗默认、首屏开哪块板、UI 缩放 0.85、老版那两份样式要不要拆——第 4 条的性质变了，见第 5 节）；⑤ 老版 `next/carriers/.gitkeep` 残留与其配套的点文件过滤、Electron ABI 档／RAG 打包形态／CI 接线，三条与批次 1、2、3 同状态，本批未推进。

---

## 1. 这一批交付的八块东西

**① 图标竖条（重写 `next/shell/ActivityRail.vue`）。** 44px 宽、纯图标、一格一块板、底部一格主题开关。度量抄的是老前端 `.workspace-activity-bar`（`src/components/workbench/WorkspaceContentGroups.vue:190-196` 的 scoped 样式，没法 import）：`flex: 0 0 44px`／`width: 44px`／`height: 46px`／`padding-top: 4px`／`margin-bottom: 8px`。这五个数字由门禁**回老文件逐个核对**——抄歪了门禁就红。图标与提示浮层复用老前端本体（`WorkbenchIcon.vue`＋`workbenchTooltip.js`，后者 250ms 延时、`side` 选项都在）。

**② 索引窗（新文件 `next/shell/IndexWindow.vue`）。** 就是作者说的「会话管理或文件结构管理的页面」：板块标题栏＋折叠按钮＋新建行＋目录树＋只读清单。行直接用老版 `.workspace-nav-item`／`.workspace-nav-item--tree` 词汇，行高、悬停、选中、焦点环全是老件那份 CSS 给的。宽度沿用老版目录窗的口径（200–360px，见 `WorkspaceContentGroups.vue:155` 的 `aria-valuemin/max`），可拖。

**③ 单一数据源（新文件 `next/shell/useBoardData.mjs`）。** 章节与条目的唯一归属。所有取数只经 `IPC_CHANNELS.runtimeToolCall` 一条通道；`{ok:false,code,message}` 一律变成界面可见的话，不吞错。保存带读到的修订号走 `pinax_chapter_save`，`PINAX_STALE_REVISION` 时把服务端原话摊开并明说「外壳不做静默合并」，草稿留在作者手里。存完就地推进索引窗里的版本号，不为一次保存重读整章（重读会把「已保存」那句提示冲掉）。

**④ 核心区只放正文（重写 `next/shell/CenterSlotHost.vue`＋`next/shell/CarrierPaneHost.vue`）。** `CarrierPaneHost` 变成纯文档面：章节编辑面／条目详情面／认不出的 pane 的一句实话（「Next 外壳还没为这块 pane 实现视图」，且一个工具都不调）。原来的目录列表视图（书稿册、条目册）整块搬进索引窗，核心区不再有第二份列表。

**⑤ 外壳根组件（重写 `next/shell/AppNext.vue`）。** 根节点 `<div class="next-shell app-shell">`——那个 `app-shell` 就是第 4 条的钥匙。板块由 `left`＋`center` 两组 pane 按 `pluginId` 归并而来（一个载体＝一格竖条＝一份树＋一份正文），主载体置顶。两条把手都在各自面板的右缘（往左拖＝变宽），索引窗夹在 200–360、右栏夹在 260–640。

**⑥ 视觉层（重写 `next/shell/styles/next-shell.css`）。** 删掉了上一批抄来的 `--nx-nav-hover`／`--nx-nav-selected`（老件现在原样生效，不许再抄）；新增竖条、索引窗、树行、新建行、静态清单行的规则。**整份没有一个硬编码颜色**——这条门禁一直在。

**⑦ 复用缝扩到五份本体（改 `next/shell/styles/legacy.mjs`）。** 除了上一批的三份，加 `src/styles/workspace-navigation.css` 与 `src/styles/workspace-surfaces.css`——正是批次 3 记着「引了也不生效」的那两份。它们现在生效了。

**⑧ 顶部菜单补 `设置`（改 `next/shell/menus.mjs`）。** 作者的 ①：「顶部有一个类似文件/编辑/视图/帮助/设置的功能选项」。`文件／编辑／视图／运行时／窗口／设置／帮助` 七项齐全，`设置` 下挂 `切换明暗主题`（走主进程 → `IPC_EVENT.menuInvoked` → 外壳换主题，与竖条底部那格共用同一个 `toggleTheme`）与 `偏好与模型…`。

**新增／改严的门禁：**

| 门禁 | 判据 | 拦的是什么 |
| --- | --- | --- |
| 外壳根节点挂 `app-shell` | `class="next-shell app-shell"` | 忘了挂 class，老件那两段 token 与行规则静默失效（长得像但不是复用） |
| 选中色分级全部来自老版原件 | 老件的 `--nav-hover` 5%／`--nav-selected` 7%／`--nav-selected-secondary` 5%／`--nav-primary-selected`＝`--workbench-selected` 逐条正则回老文件抠出来对账；Next 布局层里一个 `--nav-*` 都不许定义 | 把老件的选中色公式抄一份，两边各漂各的 |
| 竖条度量与老文件数字一致 | 44/46/4/8 五个数字在老 SFC 与 Next CSS 里同时出现 | 抄歪了度量 |
| 索引窗行用老版词汇 | `class="workspace-nav-item workspace-nav-item--tree nx-tree-row …"` | 又冒出自造的导航行 |
| 顶部菜单七项齐全 | `MENU_TEMPLATE` 的顶层 label 数组＝`['文件','编辑','视图','运行时','窗口','设置','帮助']` | 少一项（作者 ①） |
| 旧轨只许引三个叶子件 | 外壳引老前端只许引 `WorkbenchIcon.vue`／`workbenchTooltip.js`／`WorkbenchTooltip.vue`；这三个自己只许引 `vue`／`lucide-vue-next`／自己的邻居 | 「复用」滑成把老前端运行时拖进薄渲染层 |
| 菜单事件换主题 | 主进程 `menuInvoked` 事件到了外壳，`html.theme-light` → `theme-dark`，`app_theme` 落库 | 菜单画了但点了没反应 |

---

## 2. 实测数字

| 段 | 命令 | 结果 |
| --- | --- | --- |
| 验收（M1 ①–⑦ ＋ M2 ⑧–⑭） | `node next/testing/acceptance.mjs` | **16/16**（与批次 2、3 同） |
| 内核/合同单测 | `node --test "next/tests/*.test.mjs"` | **116/116**（批次 3 是 112，本批 ＋4：菜单七项、菜单事件换主题、两条旧轨叶子件门禁） |
| 外壳界面测 | `vitest run --config next/vitest.next.shell.config.mjs` | **25/25**（批次 3 是 21，本批 ＋4）。三个文件：`shell-ui` 12、`carrier-pane` 10、`carrier-pane-real` 3 |
| 源码 lint | `npm run lint:next` | 0 错 0 警（`--max-warnings 0`） |
| 打包门禁 | `node next/testing/bundleAssertions.mjs` | 全过：主进程 bundle **861.0 kB**（批次 3 是 860.8，＋0.2）、渲染层 js **298.4 kB**（批次 3 是 237.3，＋61.1：新增索引窗与数据层）、渲染层 CSS **81.3 kB**（批次 3 是 70.3，＋11.0：多引了两份老件）、霞鹜文楷 woff2 **607.10 kB**、产物内 express 命中 **0**、外部说明符 10 条全在白名单内、import 产物后 in-process 列出 **19** 工具 |
| 规模 | `next/` 源码（排除 `node_modules/.build`） | **74 文件 / 9580 行**（批次 3 是 72/9226）。按目录：`tests` 17/3131、`shell` 17/2049、`runtime` 9/963、`carriers` 7/944、`kernel` 7/901、`testing` 4/503、`project` 4/417、`fs` 3/384、根 6/288 |

**运行期实测（不是读源码，是浏览器里量出来的；视口 1424×835）：**

| 量 | 实测 | 对照 |
| --- | --- | --- |
| 图标竖条宽 | **45px**（44 + 1px 边框） | 老件 `flex: 0 0 44px` |
| 索引窗宽 | **256px**（可拖，夹在 200–360） | 老件目录窗 `aria-valuemin 200`／`max 360` |
| 核心区宽 | **753px** | 中间那一栏 |
| 正文编辑面 | **705px 宽 × 517px 高** | 占满核心区，保存键与板块声明都还在视野内 |
| 右栏宽 | **360px** | 运行时独占 |
| 索引窗里的树 | `1. 第001章-入场 第 1 版`／`2. 第002章-槐巷 第 1 版` | 与磁盘上的章节一致 |
| 当前行底色 | `color(srgb 0.910392 0.910392 0.906667)` | ＝5% 墨色叠 `#f3f3f2`＝老件 `--nav-selected-secondary` |
| 竖条当前项底色 | `rgb(226, 227, 226)` | ＝`--workbench-selected`＝老件 `--nav-primary-selected` |
| 导航面底色 | `rgb(243, 243, 242)` | ＝`--surface-workbench-muted`＝老件 `--nav-surface` |
| 索引窗行高／字号 | `36px`／`14px` | 老件 `.workspace-nav-item--tree` 档 |
| 原生应用菜单 | `文件 / 编辑 / 视图 / 运行时 / 窗口 / 设置 / 帮助` | 作者 ①；`设置` 下 `切换明暗主题 / 偏好与模型…` |

可视证据（本机预览目录，不在仓库内）：`D:\next-preview\shots\12-batch4-core-fill-light.png`、`13-batch4-core-fill-dark.png`（明暗两套）、`14-batch4-setting-board.png`（点竖条第二格＝设定板：索引窗换成世界书条目树，核心区换成条目详情）。

---

## 3. 踩坑账（这一轮踩的、查清的）

1. **模板里引用了一个没定义的 `canPickPrimary`。** 重写 `AppNext.vue` 时把向导的条件表达式留了下来，变量却没定义 → Vue 当它是 `undefined`（假）→ `v-if` 的载体列表整个不渲染 → 测试里 `.wizard-item` 命中的是「用第一个可用载体新建项目」那个按钮 → `setPrimary` 收到 **0 次**调用。**坑在「静默」**：断言失败信息只说「调用次数 0」，看���像是通道没接。改成 `carriers.some((item) => item.primary)` 后同一条测试一次过。
2. **索引窗的选择器把静态清单行也吃进来了。** 断言「最后一行是第 2 版」时，`.nx-index-window .workspace-nav-item` 命中的最后一条是固化骨架里的 `约束`——骨架行与归档行也挂着 `.workspace-nav-item`。修法不是改断言，是给真正的树行单独一类（`.nx-tree-item`），静态行标 `.nx-tree-static`（并压暗一档，别让人以为是能打开的面板）。
3. **真链路那条用例是「超时」而不是「失败」，安静得吓人。** `carrier-pane-real.spec.mjs` 里那句还在找老布局的 `.rail-item`／`.entry-link`，于是在 `waitFor` 里死等 5 秒，报出来的是 `Test timed out in 5000ms`——看不出「布局变了」这四个字。改成新选择器（`.nx-ribbon-item[aria-label="设定"]`／`.nx-tree-item`／`[data-pane-id="setting.entries"]`）后 3 条真链路用例全绿。
4. **假工具少写一个 handler，断言就静悄悄失去意义。** `shell-ui.spec.mjs` 里那条「选中行标出当前项」的假 `runtimeToolCall` 只回了 `pinax_chapter_list`，没回 `pinax_chapter_read` → 读章失败 → `selection` 没落 → 那一行永远不是 `is-active`。补上 `chapter_read` handler 后这条断言才真的在测「谁被选中」。
5. **Electron 的 ESM 主入口里，顶层 `await app.whenReady()` 会把自己锁死。** 为了取证原生菜单写了个探针，模块顶层 `await app.whenReady()` 永远不 resolve——**`ready` 事件是在主入口模块求值完之后才发的**，顶层 await 等的就是自己。改成模块内 `void (async () => { … })()` 后立刻就绪。这条踩坑跟外壳代码无关，但会让人以为「菜单建不出来」。
6. **Windows 上 `app.exit(0)` 会把管道里的 stdout 截掉。** 探针 `console.log` 完立刻 `app.exit(0)`，输出一个字都没留下——退出码还是 0，看着像「跑通了但没输出」。改成 `writeFileSync` 落文件才拿到菜单标题。
7. **第二个 Electron 实例会跟第一个抢 Chromium 的单例锁。** 探针与预览窗口同时开着时，探针连 `app.whenReady()` 都走不到（配了独立的 `--user-data-dir` 也不行）。取证时先停预览、跑完探针、再把预览起回来。
8. **老版那两份 CSS 的作用域墙，靠挂 class 就能翻过去，不必拆文件。** 批次 3 记的是「整份作用域锁在 `.theme-legacy .app-shell` 上，引了也不生效」——但只要 Next 根节点也长成 `.app-shell`，祖先链就成立，规则原样生效。实测祖先链：`.nx-tree-item ← LI ← .nx-tree ← .nx-index-body ← .workspace-sidebar ← .next-shell.app-shell ← DIV ← BODY ← html.theme-legacy`。**这是本批最省力也最正确的一步**：没有拆老文件、没有重定义 token、没有任何一处「复制粘贴原版公式」。
9. **`vue/no-mutating-props` 在 essential 档里，改 props 会被 lint 拦。** 草稿是共享状态（`useBoardData` 的 `draft`），不能用 `v-model` 直改 prop，改成 `:value="data.draft"` ＋ `@input="data.setDraft($event.target.value)"`。
10. **正文是核心区的主角，编辑器就该把高度吃满。** 第一版布局里编辑面固定 `min-height: 340px`，下面空出两百多像素，正文读起来还是「挤在一堆功能页面里」。改成 `.pane`／`.editor` 竖向 flex 撑满、编辑面 `flex: 1`，正文区高从 340px 涨到 **517px**，保存键与「板块声明」仍在视野内。

---

## 4. 复现

```bash
npm run verify:next                                  # 五段全跑，exit 0
node next/testing/acceptance.mjs                      # 16/16
node --test "next/tests/*.test.mjs"                  # 116/116
npx vitest run --config next/vitest.next.shell.config.mjs   # 25/25
npm run lint:next                                    # 0 错 0 警
node next/testing/bundleAssertions.mjs               # 打包门禁 a–i
```

预览窗口（隔离演示项目 `D:\next-preview\雨夜靶场`，不碰作者原稿）：

```bash
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js \
  D:/next-preview/preview-shell.mjs --remote-debugging-port=9222
```

可视证据（本机预览目录，不在仓库内）：`D:\next-preview\shots\12-batch4-core-fill-light.png`、`13-batch4-core-fill-dark.png`、`14-batch4-setting-board.png`；复用取证 `D:\next-preview\legacy-reuse-probe.txt`，菜单取证 `D:\next-preview\menu-probe.txt`。

---

## 5. 未覆盖项与待裁定（逐条给去处）

1. **窗口仍然只是「截图看过」。** 作者人在手机侧，真实桌面上没人用这窗口点过一轮：鼠标悬停态、滚动、焦点环、真实点击的选中行为都只有静态截图与计算样式作证。**待裁**：要不要在作者方便时开一轮真机走查。
2. **一次真模型调用仍然没有**（批次 2 §5.1 原样欠着）。这仍是下一批第一件该做的事。
3. **索引窗里的树只有两类。** 正文章节（`novel.*`）与世界书条目（`setting.*`）有树可点；固化骨架里的 `大纲/构思/资料/日志/约束` 目前只是**静态清单行**（压暗、不可点），各自还没有对应工具与树。**待裁**：先给「大纲」补一棵可点的树（`pinax_outline_read` 已经在小说载体的工具面里），还是先把现有两类做扎实。
4. **老版那两份 `.app-shell` 作用域样式要不要拆——这条的性质变了。** 批次 3 的问法是「引了也不生效，要不要拆成可复用片段」。本批的实测结论是：**不必拆**，外壳根节点挂上 `app-shell` 之后，那两份 CSS 原样生效（实测行高 36px／14px、当前行 5% 墨色叠导航面，与老件公式逐位对得上）。**现在的真问题变成**：Next 长期挂着 `app-shell` 这个 class 去蹭老版作用域，要不要在老前端侧把作用域改成「可组合的片段」？那是老前端的重构，不该混进 Next 的功能批。
5. **明暗默认取哪个。** 仍跟老前端一致，**默认亮色**。**待裁**：Next 作为 Electron 应用是否也默认亮色，还是按 `prefers-color-scheme` 走。
6. **首屏开哪块板。** 现在首屏是主载体那块板（小说），核心区落正文；设定板在竖条第二格。**待裁**：以载体为第一公民（现在的做法），还是首屏给设定板。
7. **UI 缩放 0.85 没有继承**（老前端 `themeStore.js` 那套全局 zoom＋反补偿）。Electron 窗口本身就是视口，没有 URL bar，那套补丁没有存在理由。**待裁**：确认不继承；若作者想要放大观感，应调 Next 自己的 `--nx-*` 尺寸变量。
8. `next/carriers/.gitkeep` 残留与其配套的点文件过滤、Electron ABI 档／RAG 打包形态／CI 接线——三条与批次 1、2、3 同状态，本批未推进。

---

## 6. 下一批的入口

按「先有成果」的顺序：**打一次真模型调用并出证据**（第 5 节第 2 条）仍是第一件；第二件是**给索引窗补第三棵树**（大纲，第 5 节第 3 条），让骨架目录不全是静态行；第三件是把第 5 节 5–7 条的口径裁定落进代码与门禁。这三件都不动老前端——老前端那两份样式的拆分（现在只是「要不要拆」的问题，不拆也能工作）单独排一批，别混进功能批。夹具轨道仍然活着：`next/testing/fixtures.mjs` 与 `unclaimed 14` 同时被测试钉着。

> 本批**没有提交、没有推送**（作者的规矩：没明确指令不 commit）。改动都在本机工作副本 `D:\Pinax-main\Pinax-main` 里。
