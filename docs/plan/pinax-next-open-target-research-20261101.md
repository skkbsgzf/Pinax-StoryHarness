# 调研：开窗缺省语义——为什么"打开新插件页"一定先弹悬浮窗（2026-11-01）

> 作者原话（本次需求）：「我在最新的代码里面更新了几个分屏，还有小窗的一些界面，但我觉得现在的逻辑完全是混乱的。每当我想打开一个新的插件页的时候，它默认都是先给我弹出一个悬浮窗，这个完全就不是用户的逻辑。我希望它可以参考大部分笔记类软件、浏览器软件、IDE：当它打开多个的时候，首先考虑的是**切换**，其次考虑的是**分屏**，然后用户指定的情况下，再去考虑**卡片和悬浮窗**这种格式。你先进行一些深度的调研。」
>
> 口径：本文只做调研与判据，不动代码。结论先行，每条断言带 `file:line` 或磁盘证据；没实测的推导一律标「推导」，不当成功夫已做。

---

## 0. 结论先行

| 判断 | 成立与否 | 依据 |
| --- | --- | --- |
| 「默认弹悬浮窗」是实现 bug | **不成立** | 它是批次59 铁律二的落地：`next/shell/AppNext.vue:750` `const shouldMaximize = maximize ?? !anyOpenWindow()`——第一扇占页，**此后每一扇都落浮窗**。铁律二出自作者 11-01 原话①「中间的 doc 栏……它是浮窗的形式，甚至还不占页」，见 `docs/plan/pinax-electron-next-m2-batch59-ticket-20261101.md` |
| 缺的不是浮窗，是**「切换」这一档整个不存在** | **成立** | `tab` 在 v2 里只表示**收起态**（`next/shell/workspace.mjs:28` `MINIMIZED_MODES=['none','tab']`），`.nx-pane-window-tab` 是右缘竖排标签（`next/shell/PaneWindow.vue:211-221`、`styles/next-shell.css:1045`）。**开着的窗没有任何标签栏／切换器**；唯一的"类标签"UI 是 `.nx-center-tabs`（`AppNext.vue:1478`），而它只在「一个载体声明了 ≥2 块 center pane」时出现——11 块载体里只有 `comic` 满足（其余 10 块 center=1） |
| 协议 @4 已经把"该开在哪、能开几份"写明白了，但开窗路径没吃 | **成立** | ① `multiplicity/scope/keyField` 内核校验齐（`next/kernel/carrierManifest.paneSemantics.mjs:17-50`），11 份清单全填，宿主读取点**只有 doctor 诊断**（`next/doctor.mjs:236-254`），`openInstance`（`workspace.mjs:344`）根本不查 multiplicity；② `claims/priority/canOpen/takes` 有四步裁决纯函数 `resolveResourceClaim`（`next/shell/viewRegistry.mjs:336-394`），但唯一调用点 `noteClaim` 自己写着「**纯旁路，不改变打开路径**」（`useBoardData.mjs:2135-2141`），实际开哪块 pane 走的是 `chosenCenterPaneFor`＝第一块／作者点过的那块（`AppNext.vue:732-738`） |
| 更深的结构缺口：**一扇窗绑一块 pane，而"当前文档"是全局单格** | **成立** | 窗口记录只有 `pane` 字段（`workspace.mjs:93-102`），文档选择是 `useBoardData` 里一格 `state.selection = {type, item}`（`useBoardData.mjs:166`，写入点 :339/:688/:781/:900/:1008/:1133/:1318/:1469），所有 `PaneWindow` 共用同一个 `data` 对象（`AppNext.vue:1547-1553`）。推论：**同一块 pane 开两扇＝两半显示同一份文档**；`multiplicity:'keyed'`＋`keyField:'path'`（世界书条目，`carriers/worldbook/manifest.mjs:47`）没有落地载体；并排对照两章正文在当前模型里做不到 |
| 现在的缺省语义彼此打架（"混乱感"的来源） | **成立**，见 §2 七条 | 每条都有落点 |

**一句话**：批次59 把「共存」做成了「浮窗」，但没做「共存的第一档＝切换」。要修的不是一个默认值，而是补上**页（page/tab）这一层**——让"开新页"默认换页、显式才分屏、再显式才浮窗；而 `multiplicity/scope/keyField` 与 `claims/priority/canOpen/takes` 这两组已经存在但没消费的 @4 字段，正好是这一层的数据来源。

**外部对照的先手结论（12 家产品＋两个系统级对照，IDE／浏览器见 §3.1、笔记类见 §3.2，均取一手来源；Roam 与 OneNote 证据薄，已在原处标注）**：查到的家里**没有一家把自由浮窗当缺省落点**，且三条共识跨语境成立——① 裸激活（点、回车、链接左键）**永不新建容器**，只换当前容器里的内容；② 第二容器**永远只花一个修饰键**，且各家把"分屏／另开一栏"放在这一档（Obsidian `Ctrl+Alt+点击`＝新标签组、VS Code `Ctrl+Enter`＝Open to the Side、Logseq/Roam `Shift+点击`＝右栏）；③ 浮窗／独立窗是**手势最深处**——Obsidian 要 `Ctrl+Alt+Shift` 三键才开独立窗，JetBrains detach 是 `Shift+F4` 或右键菜单里点名的那一条，浏览器要"拖出标签"这个刻意动作。唯一的例外只有两类，且都能反证我们不该把稿子页做成浮窗：VS Code 的设置／快捷键这类**一次性工具页**可开成居中浮层（`workbench.editor.useModal`，可 Esc／可最大化／可移回成页签——给现有 SettingsModal 背书，给不了"正文页默认浮窗"背书；且这是条弱反例——1.110 版记原话是 opt-in（「Set it to `some` for opting into this experience」），不是开箱缺省，见 §3.1），以及 Notion 数据库行点开默认**侧边／居中 peek 覆盖层**（注意：peek 是"预览一张卡"，不是"叠一扇自由窗"）。**IDE 与笔记类在"页多到装不下怎么办"上是分道扬镳的**：IDE 用 LRU 上限＋钉住＋预览页收口（JetBrains 标签上限默认 10、VS Code `workbench.editor.limit.value` 默认 10），笔记类**没有任何一家设标签上限**，它们的答案是**切换器**（Obsidian `Ctrl+O` / VS Code `Ctrl+Tab` quick switcher）与溢出菜单（Capacities shrink-to-fit）。最后一句自我指控：**我们在代码里 13 处、跨 7 个文件点名 Obsidian**（实测 `grep -rn "Obsidian" next/shell/`：ribbon、三栏骨架、doc 类载体、properties、设置页目录与搜索、Views 协议——全清单见 §3.2），却恰恰在"点一下＝换页、加一个修饰键＝分屏、三键＝浮窗"这条 Obsidian 最核心的缺省链上反向走了——所以作者的直觉不是偏好问题，是行业缺省问题，而我们的代码在这一点上是反向的（§2 第 1／5／6 条）。同时要说清前置：**"切换"这一档不是把默认值改掉就能有的**，它要求界面上先存在"开着哪些页"的可见列表与后退通路，而这两样在当前代码里都查无此物（§5.1、§7）。

---

## 1. 现状模型（先讲清楚它到底是什么）

### 1.1 一扇窗＝一条工作区记录

`next/shell/workspace.mjs` v2，每条 `<paneId>#<n>`：

```
{ instance, pane, geometry:{x,y,w,h}|null, z, minimized:'none'|'tab',
  maximized:boolean, tiledWith:instance|null, tileSide:'left'|'right'|null }
```

四态互斥（`PaneWindow.vue:57-62` 的 `state`）：`tab`（收起，右缘竖标签）＞ `maximized`（铺满中栏）＞ `tiled`（与搭档各占一半）＞ `floating`（自由几何）。批次59 铁律三「浮窗↔分屏↔收起↔关闭＝同一扇窗同一套 chrome」是这条状态机，**这一点是对的，要保留**。

### 1.2 缺省落点的三条真实规则

| 入口 | 走的代码 | 结果窗态 |
| --- | --- | --- |
| 启动／首扇 | `AppNext.vue:1023`（`!anyOpenWindow()` 且非 gallery）→ `:752` | `maximized`＝占页 |
| 竖条点另一块载体、蓝链跳跨载体、迷你大纲点行、素材点卡 | 全部收口到 `showBoardWindow`（调用点 `:779`/`:868`/`:1125`/`:1130`/`:1505`） | **已有任何一扇没收起 ⇒ 一律浮窗**，几何＝`DEFAULT_FLOATING_GEOMETRY{48,48,760,560}` ＋ 24px 级联（`AppNext.vue:686`，`workspace.mjs:40`） |
| 索引窗「悬浮」钮（overlay pane） | `AppNext.vue:843-852`，直接 `open(..., nextFloatingGeometry())` | **永远浮窗**，连"首扇占页"都不走 |
| 左树点一行／看板点一行／图谱点节点／知识检索命中 | 只调 `data.openX`，**完全不碰窗口系统** | 内容在**已经开着的那扇窗**里换；一扇都没开＝点了没反应 |
| 窗右上「分屏」钮 | `AppNext.vue:811-836` | 搭档选取是启发式：已开着的另一扇窗 → 同载体另一块 center pane → 同载体 overlay → **同一 pane 再开一份 `#n`**；然后 `tile()` 对半贴 |

`openInstance` 只被分屏兜底用到（`:831`）；`showBoardWindow` 永远开 `#1`（`:111` `paneInstance`）。也就是说**"再开一份"没有独立入口**，只有点分屏点到一个都没有时才会被动产生。

### 1.3 真盘现场（《大梦》工作副本，非摆拍）

`D:\Projects\大梦\.pinax\workspace.json`（2026-11-01 15:07 写入，作者真实操作积累）：

```
version 2 / entries 5
novel.editor#1         z=3  MAX   {"x":48, "y":48,  "w":760, "h":560}
outline.editor#1       z=4  float {"x":72, "y":72,  "w":760, "h":560}
notes.editor#1         z=5  float {"x":96, "y":96,  "w":760, "h":560}
worldbook.entries#1    z=6  float {"x":120,"y":120, "w":760, "h":560}
dossier.editor#1       z=8  float {"x":144,"y":144, "w":760, "h":560}
```

五块载体全在场：正文那扇铺满整栏（`maximized`）**却被四张 760×560 的卡逐层盖住**，`z=7` 是已关掉留下的空洞。按 CSS 算（`.nx-ribbon` 44px 固定 `next-shell.css:252-258`、索引窗 220–360px、右栏 340px、默认窗 1440×900 ＋ 界面缩放 0.85，`shell/main.mjs:203/:294`）中栏可用宽约 1000px 上下——**一张 760px 的浮窗就吃掉约七成宽度**，第三张起基本没有可见的"页"。这是"混乱"的几何学解释（宽度为按 CSS 推算，未做真窗口截图实测）。

---

## 2. 七条彼此打架的地方（逐条带证据）

1. **同一个"打开"，两套缺省**：跨载体走 `showBoardWindow`（首占页／后浮窗），overlay pane 走 `toggleBoardOverlay`（永远浮窗）。`AppNext.vue:744-760` vs `:843-852`。
2. **同一个蓝色链接，两套落点**：条目详情面的蓝链经 `openKnowledge`→`showBoardWindow`（`:771-780`，会开一扇新浮窗）；正文阅读态里同样的蓝链直接 `props.data.openEntry`（`CarrierPaneHost.vue:303-308`），**不开窗、不抬高**。同一功能两种后果。
3. **反向链接又是第三种**：`EntryDetailPanel.vue:97-100` 的 `openBacklink` 只 `data.openEntry`，绕开 `openKnowledge`。
4. **左树点击不保证看得见结果**：树只换 `selection`，不碰窗（`IndexWindow.vue:698/:816/:923/:968/:1118/:1167`）。若该载体的窗被别的浮窗压着（§1.3 正是这状态），点了行＝内容在底下换，界面不动。**作者体感"点了没反应"就是这一条。**
5. **`multiplicity:'keyed'` 是死声明**：世界书条目声明 `keyed`＋`keyField:'path'`，但宿主没有按 key 的实例概念（实例只有数字 `#n`，`workspace.mjs:344-352`），也不查 multiplicity；唯一读取点 `doctor.mjs:236-241` 还是"发现你多开了就报 incompatible-form"。声明与实现反向。
6. **分屏可能屏出两份一样的东西**：搭档兜底到"同一 pane 再开一份 `#2`"（`:831`），而两扇都渲染同一个 `data.selection`（`:1547-1553`）⇒ 左右半屏显示同一份文档。对单 center pane 的载体（11 块里有 10 块）这是常态路径。
7. **重启后的缺省和首次不一样**：`workspace.json` 按项目落盘（`workspaceStore.mjs`／`.pinax/workspace.json`），有存档时 `hydrateWorkspace`→`syncWorkspaceForView` 只补数据、不改窗态（`:1020-1021`），于是"首窗占页"这条规则对新开的那扇**不再生效**（因为 `anyOpenWindow()` 已经为真）。同一套动作，第一次跑和第二次跑结果不同。

另有两处卫生问题（不影响本次判断，记账）：`workspace.mjs:597/:601` 的 `openPaneWindow`／`paneEntry` 零宿主调用；`next/index.mjs:24` `KERNEL_INFO.openSlots` 少列 `overlay`，与规范源 `slots.mjs:9`、`host-descriptor.json:7` 不一致。

---

## 3. 外部一手来源对照

### 3.1 IDE 与浏览器（调研线乙，一手来源已核）

| 产品 | 裸激活（点一下）落在哪 | 显式"新标签" | 显式"分屏" | 显式"浮窗／新窗口" | 浮窗当过缺省吗 |
| --- | --- | --- | --- | --- | --- |
| VS Code | **预览态**：复用那枚斜体预览页，下一次单击换掉它；双击或开始编辑才转成固定页（[userinterface](https://code.visualstudio.com/docs/editing/getting-started/userinterface)、[1.3 版记](https://code.visualstudio.com/updates/june_2016)） | 双击固定；已开过的文件走 `Ctrl+Tab` MRU 揭示 | `Ctrl+Enter`「Open to the Side」→ 新 editor group；`Ctrl+K Ctrl+Shift+\`「Split Editor in Group」 | 把页签拖出窗口，或页签右键 **Move into New Window / Copy into New Window** → Floating window（可 Always on Top／Compact Mode）（[custom-layout](https://code.visualstudio.com/docs/configure/custom-layout)） | **没有**——浮窗只能拖出来或菜单点名 |
| JetBrains IDEA | 开页并聚焦；可选 **preview tab**（斜体，逐次替换，需勾「Enable Preview Tab」）（[using-code-editor](https://www.jetbrains.com/help/idea/using-code-editor.html)） | 双击／开始编辑转固定 | 页签右键／Window ▸ Editor Tabs → **Split Right / Split Down**（默认无键位） | **`Shift+F4` Detach** → 独立窗口自己摆位；工程开新窗与否是设置项或"问问我"（[open-close-and-move-projects](https://www.jetbrains.com/help/idea/open-close-and-move-projects.html)） | **没有** |
| Firefox | **同页导航** | `Ctrl/⌘+点`／**中键** → 后台新标签；`Ctrl+Shift/⌘⇧+点` → 前台（[SUMO 鼠标快捷键](https://support.mozilla.org/en-US/kb/mouse-shortcuts-perform-common-tasks)） | 无原生分屏 | `Ctrl+N`／右键「在新窗口打开」；脚本开窗无用户手势即被拦（[MDN window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open)） | **没有** |
| Chrome / Edge | 同页导航 | 同 Chromium 家族；`Ctrl+T` 新标签（[Edge 快捷键](https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge)） | **Edge 分屏视图**：只在「设置和更多 → 拆分屏幕」或工具栏钮触发，**永不自动**（[explore.microsoft.com](https://explore.microsoft.com/en-us/edge/features/split-screen)） | `Ctrl+N`／菜单；无手势 `window.open()` 返回 null | **没有** |
| Safari / macOS | 同页；`⌘-点` 后台新标签（[Safari 手势指南](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac)） | `⌘⇧-点` 前台 | **Split View**：悬停绿灯出平铺菜单，或把窗拖到屏幕边（[Use apps in Split View](https://support.apple.com/guide/mac-help/use-apps-in-split-view-mchl4fbe2921/mac)） | 菜单「新建窗口」`⌘N`；Stage Manager 是要主动开模式 | **没有** |
| Windows 11 | 聚焦／收进任务栏 | — | **Snap layouts**：拖到边或悬停最大化钮选版式（[Snap Your Windows](https://support.microsoft.com/en-us/windows/experience/snap-your-windows)） | `⌘Win+D` 等新实例；系统自己推荐贴边而不是自由摆位 | **没有** |

**五条反复出现的规律（每条 ≥2 个一手来源）**：

1. **裸激活永不新建容器**——要么原地换内容，要么复用／揭示已有的那一格。VS Code 单击复用预览页；浏览器不加修饰键就是同页导航（MDN 原话还警告"强制在新窗口打开会让用户困惑"）。
2. **分屏永远是第二档的显式动作**（修饰键＋Enter、菜单项、拖到边）。这一档六行对照里没有一家"第一次打开就自动分屏"，更没有"第二次打开就变成新窗口"——**我们的「首窗占页、次窗浮窗」在这条上是反向的**：别人给的永远是同一块面的切分，不是另起一扇窗。
3. **浮窗／新窗必须是有名字的刻意动作**（拖出、`Shift+F4`、`Ctrl+N`、右键菜单项），脚本自己开窗会被拦。
4. **页多到装不下时靠 LRU 上限与钉住收口，不靠开窗**。JetBrains 标签上限默认 **10**、钉住的不计（[settings-editor-tabs](https://www.jetbrains.com/help/idea/settings-editor-tabs.html)）；VS Code `workbench.editor.limit.value` 默认 **10**、默认关、关"最久未用"（[v1.42 版记](https://code.visualstudio.com/updates/v1_42)）。
5. **恢复的是"布局＋开了哪些页"这一层**：VS Code hot exit ＋ `window.restoreWindows: all`；Firefox「恢复上次会话」连标签带窗口；JetBrains「Reopen projects on startup」。没有一家把自由几何当承载标签的主布局。

**要如实列出的反例**：VS Code 有一档例外——`workbench.editor.useModal` 让设置／快捷键／Profiles／AI 模型管理／工作区信任这类**一次性工具页**开成居中浮层而不是页签，这是查到的唯一"自动浮"的面。版本要说清：1.110（2026-02）版记原文是「Set `workbench.editor.useModal` to `some` for opting into this experience」（[v1.110](https://code.visualstudio.com/updates/v1_110)）——**注意这句本身说明它是"opt-in"，不是开箱缺省**（本轮没有取到现行缺省值的设置表正文，所以不写"默认即浮"，见本节末未验证项）。它的缓解措施同样明确，官方 UI 文档原话：「You can dismiss a modal editor by clicking outside of it, pressing Escape, or selecting the close button. You can also maximize it to fill the editor area, or [move it to a regular tab]」（[User interface](https://code.visualstudio.com/docs/editing/getting-started/userinterface)），即浮是**短暂且可降级**的。这一条其实支持我们保留 SettingsModal 现状（历史／提案审阅／偏好都在那一层），但不能拿来给"作者稿子页面默认浮窗"背书。

**可直接引用的设置项与命令名**（写进规范用）：`workbench.editor.enablePreview`、`workbench.editor.enablePreviewFromQuickOpen`、`workbench.editor.revealIfOpen`（v1.11 起、需显式开）、`workbench.editor.openSideBySideDirection`、`workbench.editor.closeEmptyGroups`、`workbench.editor.showTabs`（`multiple|single|hidden`）、`workbench.editor.limit.enabled/.value/.perEditorGroup/.excludeDirty`、`workbench.editor.useModal`、`window.restoreWindows`、`window.openFoldersInNewWindow`；命令 *Open to the Side*、*View: Split Editor in Group*、*Move into New Window / Copy into New Window*、`Ctrl+1..9`、`Ctrl+Tab`。JetBrains 侧：*Pin Tab*、*Enable Preview Tab*、*Tab limit*、*Split Right / Split Down*、*Detach*（`Shift+F4`）、*Open project in: New window / Current window / Ask*。

**这条线的未验证项**（不当证据用）：Chrome 官方支持页在本机网络不可达，用 Firefox／Edge 同族来源替代；Apple 指南页是 JS 渲染，手势表取自官方域搜索摘要（置信度低于正文抓取）；`workbench.editor.useModal` 的**现行缺省值**未取到设置表正文（只取到 1.110 版记的 opt-in 表述）；`enablePreview=true`／`revealIfOpen=false` 的缺省值是从 2016/2017 版记与公开 issue（`microsoft/vscode#167331`）推的，没拿到现行设置表正文；VS Code 浮窗是否跨会话存几何、JetBrains Split Right 是否有默认键位、Apple HIG「windows/panels」原文——都查无。

### 3.2 笔记类／PKB（调研线甲）

对我们这一档尤其要紧：代码注释里 **13 处、跨 7 个文件**点名照 Obsidian 做（`grep -rn "Obsidian" next/shell/` 实测，逐条如下）——`ActivityRail.vue:7`「Obsidian 的 ribbon」、`AppNext.vue:40`「Obsidian 三栏」、`:73`「宽屏展开（Obsidian 桌面形态）」、`:308`「参照 Obsidian 设置页」、`CarrierPaneHost.vue:46`「面向 Obsidian 的 doc 类载体」、`:51/:1821`「照 Obsidian properties」、`EntryDetailPanel.vue:104/:165` 同上、`SettingsModal.vue:13/:171` 设置页目录与搜索框、`viewRegistry.mjs:8`「对齐 Obsidian 的 Views 协议」、`styles/next-shell.css:13`「Obsidian 三栏的骨架布局」。**外壳的骨架、协议与设置面是抄它的，开窗缺省却是反的。**

| 产品 | 裸点的缺省落点 | 第二容器（分屏／侧栏）怎么触发 | 浮窗／新窗怎么触发 | 切换主入口 |
| --- | --- | --- | --- | --- |
| Obsidian | 「选中一个链接就在**当前标签**里打开」（[Tabs](https://obsidian.md/help/tabs)） | `Ctrl+Alt`／`⌘⌥`+点＝New Tab Group；或页签右键 **Split right / Split down**；或把页签拖到另一页签下沿 | **`Ctrl+Alt+Shift`／`⌘⌥⇧`+点**；页签／链接右键「Open in new window」；把页签拖出窗口（[Pop-out windows](https://obsidian.md/help/pop-out-windows)） | 标签 ＋ **Quick switcher `Ctrl+O`**；`Ctrl+Tab`／`Ctrl+1…8`／`Ctrl+9`＝最后一页 |
| Notion | 当前标签内导航；数据库行点开＝**peek 浮层**（表／看板／时间轴＝侧 peek，画廊／日历＝中 peek）（[views](https://www.notion.com/help/views-filters-and-sorts)） | 经典版无分屏，侧栏＋peek 是最接近的 | `Ctrl+Shift+N` 新窗口；**`option+shift+点`** 把页面开成新窗口 | `Ctrl+P`／`Ctrl+K` 快速跳转 |
| Logseq | 点链接**替换**唯一主面板（[右栏指南](https://github.com/logseq/docs/blob/master/pages/How%20to%20work%20with%20the%20right-hand%20sidebar.md)） | `Shift+点` → 右栏（唯一第二容器）；`t r` 开合右栏、`c t` 关顶项 | **不存在**，没有浮窗 | 搜索／跳页优先 |
| Roam（置信度低：官方帮助站打不开，靠 roamdocs 镜像＋三方键位表） | 点页面引用＝替换主面板（[navigation](https://roamdocs.fyi/help/navigation)） | `Shift+点` → 右栏；`Ctrl+Shift+O` | **不存在**（只有浏览器标签） | `Ctrl+G` 快速跳转 |
| Capacities | 「对象链接在**当前标签**打开」（[navigation](https://docs.capacities.io/reference/navigation)） | `Shift+点` → 侧面板；悬停页签＝内联预览 | 该页未记 | 标签**收缩适配＋溢出菜单**；另有切换器 |
| OneNote（一手文档薄） | 页签换页，同窗 | 桌面版无分屏概念 | 「视图 → 新窗口」显式 | 页签 ＋ `Ctrl+E` 找页 |

**这一档的五条共识（每条 ≥2 个一手来源）**：

1. **裸点不建容器**——Obsidian／Notion／Capacities／Logseq／Roam 五家全同（OneNote 证据薄，不计入）。
2. **第二个容器＝正好一个修饰键**（Obsidian `Ctrl+Alt`；Logseq／Roam／Capacities `Shift`）。
3. **浮窗是最深、最稀的那个手势**——Obsidian 用三个修饰键 `Ctrl+Alt+Shift`，Notion 用 `option+shift+点`；**没有一家让裸点或单修饰键产生窗口**。这条与 §3.1 那一档（IDE／浏览器，六行对照）同向，两档合起来是一手来源 12 家产品。
4. **"瞄一眼"与"常驻"要分，但笔记类用的是 peek 浮层而不是 VS Code 那种斜体预览页**——Notion 行点开侧 peek、Obsidian 是 `Ctrl`＋悬停的页面前瞻、Capacities 悬停页签内联预览（[Page preview](https://obsidian.md/help/plugins/page-preview)）。VS Code 的 preview-tab／双击固定模型在笔记类里**查无对应**。
5. **容器一多，主导航是切换器而不是标签栏**——Obsidian `Ctrl+O`、Notion `Ctrl+P/K`、Roam `Ctrl+G`、Logseq 搜索优先；窄屏时四家都弱化标签栏。

**如实列出的抵触与半抵触**：

- Notion 数据库行**默认**开成 peek 浮层，不算"显式要求"——所以"列表行点开出浮层"在这类产品里确实有先例。但差别要说清：peek 是**盖在同一页上的临时层、Esc 即关、不落盘**；我们的浮窗是可拖可缩、级联摆位、**写进 `workspace.json` 长期驻留**的窗口。真正该被质疑的是后者，不是"任何覆盖层都别做"。
- Obsidian 的**钉住页签**是一个 opt-in 的"自动另开一页"模式（「钉住的页签里，链接总在新标签打开」）——这说明"缺省换页"需要一个逃生口给"我要连着开一批"的场景，正好对应 §7 第 1 问的显式手势档。
- Obsidian 官方文档明写**没有标签上限**（"as many tabs as you want"），页签多了靠切换器与收缩／溢出（Capacities 的溢出文档最明确）；所以 §7 第 4 问里"LRU 上限"这一档，在笔记类这边其实没有先例支持，只有 IDE 那边有（JetBrains／VS Code 默认 10）。这条差别值得你裁。

**未验证**：Roam 官方一手文档（403/404，全部降置信）；Logseq／Roam 右栏内容是否跨重启保留；Notion 正式版标签持久化（只有 beta 页一句"open tabs carry over"）；Obsidian `workspace.json` 内部结构（帮助文档不讲）；Apple Notes／Bear 的落点表述查无一手来源。**中键语义本轮重查过**：Obsidian 官方 Tabs 页**没有**中键条目（查无，别当成共识）；Capacities 文档把中键等同 `Ctrl`＋点＝另开一页（[open links in new tabs](https://docs.capacities.io/reference/open-links-in-new-tabs)）；其余笔记类未记——所以"中键关页签／中键另开一页"只有浏览器与一家笔记类背书，属可选项而非共识。**后退／前进的缺省键位**（Obsidian 官方 Tabs 与 navigation 页均未列 Back／Forward 快捷键，Notion 未查）——查无，§5.1 那条只当方向，不写死键位。

---

## 4. 内部先例：这三档自家老前端已经做过

批次59 之前，Web 工作台的语义正好是作者现在要的次序——**这不是外来新概念，是自己扔掉的东西**：

| 档 | 老前端实现 | 语义 |
| --- | --- | --- |
| 切换 | `src/stores/workspaceTabsStore.js:119-144` `openOrFocus`：注释原文「**按 key 去重；已有标签更新定位意图后聚焦**」；命中 `existing` 就 `activate(existing.id)`，绝不新建 | 打开一份已开着的文档＝回到那一格，不重复 |
| 页的持久化 | 同 store：`activeTabId`、`lastActiveAt` 回落（`:62-73`）、失效书清理后重选（`:98-115`）、`persist()` 到 `STORAGE_KEYS.WORKSPACE_TABS`；编辑器瞬时态（caret/selection/scroll）**明确不进 persisted tabs**（`:23-25`） | 「开了哪些页」与「页内编辑到哪」分层存 |
| 分屏 | `src/components/workbench/WorkspaceContentGroups.vue:40/:163/:226`：`main` 组 ＋ `side` 组（旁区），旁区有自己的 `WorkspaceContentTabs`（`group="side"`，带 `@activate`/`@close`/`@reorder`），旁区宽度 `--workspace-reference-width`、`flex: 0 0 min(var(…), 42%)` | 第二档是**组**，不是浮窗 |
| 分屏的触发是显式的 | `src/composables/useWorkspaceProjectActions.js:32`：`host.openAt(resource, expanded ? 'main' : 'side')`——落哪个组由"旁区是否展开"这个用户动作决定 | 缺省永不产生新容器 |
| 标签溢出 | `src/components/workbench/WorkspaceTabOverflow.vue` ＋ `.workspace-content-tabs{overflow-x:auto; scrollbar-width:thin}`（`WorkspaceContentTabs.vue:38`） | 多页可滚，不靠叠窗 |

代价说明：老前端的这些标签样式写在组件 `<style>` 里，**不在** `next/shell/styles/legacy.mjs:18-22` 已经引进来的五份 CSS 本体中（`main.css`／`themes/legacy.css`／`workbench-controls.css`／`workspace-navigation.css`／`workspace-surfaces.css`）。所以复用是"照抄词汇＋走 token 纪律"，不是白拿；具体度量要过 `next/tests/visual-contract.test.mjs` 那条老前端数值对照的路子。

---

## 5. 三档落点模型（提案骨架）

**目标不变式**：一次"打开"动作，缺省**不产生新容器**；产生容器需要显式手势；浮窗是**同一条记录的状态迁移**而不是新的壳（保住批次59 铁律三）。这条不变式与 §3.1 五条规律、§4 自家 `openOrFocus` 先例同向，目前与我们代码里的缺省相反。

### 5.1 三档与触发

| 档 | 名称 | 缺省触发（不加任何修饰） | 显式升档触发（草案，抄外部成熟键位） | 结果 |
| --- | --- | --- | --- | --- |
| 一 | **切换**（缺省） | 竖条点载体、左树／看板／图谱点行、蓝链、素材卡、检索命中 | — | 在当前页组里换页／加一页并激活；**同一资源已开＝回到那一页**（`openOrFocus` 语义），不新建容器 |
| 二 | **分屏** | 永不自动 | `Ctrl+Enter`「另一侧打开」（VS Code *Open to the Side* 同键）；页签拖到栏左右边；窗右上分屏钮（既有） | 建第二个页组，承接现有 `tile` 几何；页可在组间移动 |
| 三 | **浮窗／卡片** | 永不自动 | 页签拖出页区／页签右键「弹出为浮窗」（VS Code *Move into New Window*、JetBrains *Detach*`Shift+F4` 同族）；索引窗「悬浮」钮保留（它本来就是"要浮"的动作） | 同一条记录进入 `floating` 几何态，可拖可缩；「收回为页」是它的逆迁移 |

**修饰键定档（12 家产品的一致梯度，建议直接采用 Obsidian 那一串）**：裸点＝当前页换内容／换页；`Ctrl`（mac `⌘`）＋点＝**另开一页**；`Ctrl+Alt`（`⌘⌥`）＋点＝**另一侧分屏开**；`Ctrl+Alt+Shift`（`⌘⌥⇧`）＋点＝**开成浮窗**；页签右键＝把这三档摊开给人点（**作者已裁**：形态切换走右键、不做死按钮；批次59「右键零菜单」被点名推翻的那一半见 §7 第 6 问）。这个梯度的意义是**深度＝代价**：越靠后按得越重，误触越少。现状如实说是"**修饰键管线有，但一档都不落在开窗路径上**"：全仓只有两处修饰键判断，且都只管本地动作——`Ctrl+S` 存盘（`CarrierPaneHost.vue:842-852`）与 `Ctrl+F` 全书查找（`IndexWindow.vue:375-382`）；顶层只有两处全局 keydown 且都只处理 Esc（`AppNext.vue:499/:1073`，注册于 :1344/:1347）；全仓无 `@auxclick`、无中键处理（`ActivityRail.vue:62` 的右键还是"只抑制默认菜单"）。所以这一串键位不是"改几个 if"，是要新铺一条"手势→落点档"的入参管线。

**一个必须先补的前置**：换页为缺省之所以今天不敢做，是因为**没有后退栈**——`next/shell` 里查无 `goBack`／后退前进的概念（`openHistoryFor` `AppNext.vue:391` 是文档版本历史，不是页面历史），页面一旦被顶掉就找不回来。批次59 的"多载体共存"其实是没有后退栈时的替代品。**页签栏本身就是那个替代品**（旧页仍在，只是不当前），所以第一档安全的前提是先有"开了哪些页"的可见列表；显式的后退／前进算第二优先——外部产品普遍有这组命令，但**本轮没取到可引用的一手键位表**（Obsidian 官方 Tabs／navigation 页未列 Back／Forward 快捷键），所以这条只作为方向，不写死键位，别当证据用。

### 5.2 "瞄一眼"与"常驻"要分——但笔记类和 IDE 给的是两种东西

IDE 那边的解法是**斜体预览页**：VS Code／JetBrains 单击复用同一个预览位、双击或开始编辑才转固定。这对我们看似对得上（扫世界书条目、瞄一眼素材记录是预览，真正动笔的章节是固定），而且我们已经有判据——只有固定页里的脏草稿需要落盘（批次43 自动保存基线）。

但要如实说：**这个模型在笔记类这一档查无对应**（§3.2 第 4 条），它们的"瞄一眼"是 **peek 浮层／悬停前瞻**（Notion 行侧 peek、Obsidian `Ctrl`＋悬停页面前瞻、Capacities 悬停页签内联预览）。差别在要不要占一格：预览页仍然占标签位并可被固定；peek 是盖在现页上的临时层，关掉就没了。

所以 5.2 有两个候选形态，不是一个：

- **甲＝预览页**（IDE 派）：与页签栏一体，实现顺路，但依赖 §7 第 2 问做到"每页一份文档"才安全——否则"预览页被下一个单击顶掉"就把作者正在改的那页顶掉了。
- **乙＝peek 层**（笔记派，且与 Notion 的数据库行先例同型）：素材／世界书这类**列表行点开**用临时层盖在当前页上，Esc 即关、不落盘、不进 `workspace.json`；只有"在页签里固定"才变常驻。这一档其实最贴你原话里的"卡片"。

两条都能满足"缺省不建容器"，取舍点是作者日常动作更像哪个：一边比对多份稿子（甲），还是频繁从库里翻东西看一眼就回去（乙）。

### 5.2b 切换器是并行必需品，不是可选项

§3.2 第 5 条共识是：**容器一多，主导航是切换器而不是标签栏**（Obsidian `Ctrl+O`、Notion `Ctrl+P/K`、Roam `Ctrl+G`、Logseq 搜索优先）。我们的现状是**查无此物**——全仓无命令面板、无 `Ctrl+K`／`Ctrl+P`（批次59 之后的实测：`AppNext.vue` 只有两处 keydown，都是 Esc；`menus.mjs:15-66` 的 19 个带 id 菜单项没有一项开页）。也就是说：即便加了页签栏，宽屏能用、窄屏（手机预览口 8471 那一轨）与多页场景仍然需要一个"列出开了哪些页＋直接跳"的入口。老前端的对应物是 `WorkspaceTabOverflow.vue` 的溢出菜单，可以作为最小版本。

### 5.3 缺省落点决策表（给实现当唯一口径）

```
open(resource, gesture):
  pane  = resolveResourceClaim(启用 pane, resource)     # 已有纯函数，现在只是旁路
  page  = pane.multiplicity === 'single' ? pane 的固定页
        : pane.multiplicity === 'keyed'  ? 按 keyField 取页（已有则揭示）
        : list ? 该 pane 的第 n 页 : ...
  target = gesture.split ? 第二个页组
         : gesture.float  ? 浮窗态
         : 当前页组
  落点 = target 里 reveal-or-add page，并置为当前页
```

要点：**"开在哪块 pane"由清单声明决定（claims／canOpen／priority／takes），"开成什么形态"由手势决定**——今天的实现正好相反：pane 由 board 里第一块 center 决定（`AppNext.vue:732-738`），形态由"有没有别的窗在场"决定（`:750`）。这一句就是"混乱感"的根。

### 5.4 需要新增的状态轴（v3 草案，未定稿）

页身份／页序／每组当前页／所属组／固定还是预览。`multiplicity/scope/keyField` 从死声明变成页身份判据（`single`＝换内容即切换、`keyed`＝一份资源一页、`list`＝可多份），`scope` 决定页跟着项目走还是跟着条目／会话走。既有 `workspace.json` 要一次性迁移（`D:\Projects\大梦` 那份 5 条记录是真实靶子）。

---

## 6. 改动的影响面（给派单用）

**先补前置件，再谈改缺省**——"切换"这一档不是把 `shouldMaximize` 的默认值翻过来就能得到的，它要求三样前提先落地——其中两样当前查无此物，第三样虽有但不落在开窗路径上，否则改完会从"默认弹浮窗"变成"默认把你要看的那页顶掉、而且找不回来"：

- **① 页标签栏＝切换档的可见入口，兼作后退通路的替代品**。全仓搜不到 `goBack`／`history.back` 一类的页后退栈（§8 末两条 grep 为证据），`openHistoryFor`（`AppNext.vue:391-398`，落统一二级页的 history 节）是**文档版本历史**不是导航历史；批次59 之所以选"共存＝浮窗"，实质是给"没有页列表"打的补丁——窗都留着，就不会丢。所以页标签栏不是装饰，是"换页可以安全发生"的前提。
- **② 修饰键管线**。按键管线其实**已经在**，只是没有一根落在开窗路径上：全仓仅两处修饰键判断，都是本地动作（`Ctrl+S` 存盘 `CarrierPaneHost.vue:842-852`、`Ctrl+F` 查找 `IndexWindow.vue:375-382`），顶层全局 keydown 只有两处且只处理 Esc（`AppNext.vue:499/:1073`，注册于 :1344/:1347），全仓无 `@auxclick`、无中键处理（`ActivityRail.vue:62` 的右键只抑制默认菜单）。§5.1 那串 `Ctrl → Ctrl+Alt → Ctrl+Alt+Shift` 与中键关页签，要新增的是"手势→落点档"这个入参，以及别和 `Ctrl+S`／`Ctrl+F` 抢键。
- **③ 快速切换器**。§3.2 第 5 条共识是"容器一多，主导航是切换器而不是标签栏"（Obsidian `Ctrl+O`、VS Code `Ctrl+Tab`），而我们的现状是**命令面板／Ctrl+K／Ctrl+P 查无此物**，顶层菜单四组共 19 个带 id 的项（`menus.mjs:15-66` 定义，实测 `grep -c "id: ." menus.mjs`＝19：项目 8／编辑 6／设置 3／帮助 2），**没有一项开一扇页**——设置三项开统一二级页，`project.history` 开文档版本历史；10-28 工单A 已删掉视图／窗口两组。窄屏（批次9 手机预览口）更是只能靠切换器。

其余影响面：

- **测试即规格**：`next/tests/shell-ui.spec.mjs` 88 例里 107 处命中窗口词汇；钉住当前缺省的用例至少四条——`:2745`「第一扇占页、后续浮窗」、`:2586`「中间 doc 区是窗口管理器：多扇窗共存」、`:2253`「切板：上一载体的窗保持原位（多载体共存）」、`:2678`「收起＝侧缘标签堆」。`:2377` 还有一条「同一 pane 多开（multiplicity 仍管开窗数量）」——**这条断言的名字与实现不符**（multiplicity 并不管），改模型时要么真管、要么改名。
- **visual-contract 约束**：`next/tests/visual-contract.test.mjs:443`「PaneWindow 是唯一窗口壳」、`:474` 旧容器 FloatingWidget 必须不存在、`:478-490` 载体 SFC 不许自带拖拽／定位、`:493` AppNext 必须挂窗口层——**新增页标签栏不许变成第二套窗口 chrome**，只能管"哪一页"，不能管"怎么拖"。
- **批次59 铁律要显式修订而不是悄悄改**：铁律二原文含「打开文档＝开浮窗，默认不占页」。新裁定应写成"共存能力保留，缺省落点＝切换"，并在工单里注明**本条覆盖批次59 铁律二**，否则执行方会拿旧铁律打回。
- **门禁**：`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段；批次60 后现值＝acceptance 35/35、node 测试 648、vitest 199（14 文件）、lint 0 警告、bundleAssertions 全过。**断言漂移要改断言并写理由**，不许静默放宽。
- **记账指标（不进闸）**：缺省落点分布（多少次打开产生新容器／多少换页）、同 pane 双开同文档的次数、`multiplicity` 三态各自消费点数。数值只进复核清单，不当隐形闸。

---

## 7. 要作者裁的七条

1. **缺省落点改不改**：把"首窗占页、后续浮窗"改成"换页（切换）为缺省，浮窗只能显式要"？（这覆盖批次59 铁律二的一条，需要点名。）
2. **页这一层做到哪一步**：只做"每载体一页＋页签切换"（不动 `selection`，改动小、解决盖窗问题），还是做到"每页一份文档"（`keyed` 真落地、可并排对照两章，但要动 `useBoardData` 的单格 selection 与批次43 自动保存／批次39 事件刷新基线）？
3. **"瞄一眼"用哪种形态**（§5.2 两候选，二选一或都要）：**甲＝预览页**（IDE 派，斜体页签、单击复用同一预览位、双击或开始编辑才固定）——与页签栏一体、实现顺路，但**必须先有第 2 问的"每页一份文档"**，否则下一个单击会把作者正在改的那页顶掉；**乙＝peek 覆盖层**（笔记派，Notion 数据库行同型，Esc 即关、不落盘、不进 `workspace.json`）——不依赖第 2 问，且最贴你原话里的"卡片"。**注**：甲在笔记类这边查无对应，乙在 IDE 里也不是缺省，两条都不算"行业共识"，是取舍。
4. **页多到装不下时收口方式**：可滚标签（老前端 `WorkspaceTabOverflow.vue` 的做法）／上限＋关最久未用／下拉切换器／`Ctrl+Tab` 快速切换。**要如实说这条先例是分裂的**：LRU 上限只有 IDE 那边有（JetBrains 标签上限默认 10、VS Code `workbench.editor.limit.value` 默认 10），笔记类这一档**一家都没有标签上限**（Obsidian 官方文档明写"as many tabs as you want"），它们靠切换器与收缩／溢出收口——而我们是写作工具，页数量更像笔记而非源码。另外上限是**数值线**：按你定的纪律，新数值只能记账或经你点名，不许当隐形闸。
5. **@4 死声明的处置**：`multiplicity/scope/keyField` 与 `claims/priority/canOpen/takes` 是"这轮真消费"，还是显式处置？现成的先例是 `chain`：它作为 multiplicity 的未采用取值被**写进清单就拒**（`carrierManifest.paneSemantics.mjs:11/:20` `UNSUPPORTED_PANE_MULTIPLICITIES`），比"登记为未采用"更硬。三档可选：真消费／像 `chain` 一样拒收／登记留档。留一个没人吃、测试名字还写着"管开窗数量"的声明（§6「测试即规格」那一条），等于给下一个人留坑。
6. **显式手势的落点**：修饰键＋右键菜单／页签按钮／还是回到顶层菜单——注意这与 10-28「工单A：删掉视图／窗口两个菜单组」、批次59「竖条右键不再有打开方式菜单」两条旧裁定相碰，要点名推翻哪一条。另外 §6 前置②：按键管线在，但没有一根落在开窗路径上，且得避开已在用的 `Ctrl+S`／`Ctrl+F`。
   **已裁（2026-11-01 作者追加裁定）**：「**形态切换可以多用右键，不必做成死按钮**」。落点＝页签与窗头右键共用的那份形态菜单，菜单项只从清单 `forms` 声明里出（P18 的消费端从此复活）；页签上不放常驻形态钮。被点名推翻的旧裁定是批次59 **铁律五**那一半（`ActivityRail.vue:62` 竖条右键零菜单——本批只翻"窗头／页签"两处，竖条那一处仍维持零菜单，另立 §7 待裁 ⑤），对应断言 `shell-ui.spec.mjs:2517`／`:2541` 按名改写并留理由。修饰键与中键仍整包留批次62。全文见 [批次61 工单](./pinax-electron-next-m2-batch61-ticket-20261101.md) 铁律三／四与任务 5–7。
7. **要不要同时立"切换器"这一件**（§5.2b）：`Ctrl+O`／`Ctrl+Tab` 那种"列出开了哪些页＋直接跳"的入口。它是这 12 家里容器一多之后的共同主导航，而我们现在命令面板／`Ctrl+K`／`Ctrl+P` **查无此物**（`menus.mjs:15-66` 的 19 个带 id 菜单项没有一项开页）。窄屏那一轨（批次9 手机预览口 8471）尤其没有别的解法。可以裁"这一轮不做，只记账"，但它和页签栏是**并行必需品**，不是页签栏的替代品。

---

## 8. 复现与取证命令

```bash
# 缺省落点那一条规则
grep -n "shouldMaximize\|anyOpenWindow\|nextFloatingGeometry" next/shell/AppNext.vue
# tab 只表示收起态；开着的窗没有标签栏
grep -n "MINIMIZED_MODES\|openInstance" next/shell/workspace.mjs
grep -n "state === 'tab'\|nx-pane-window-tab" next/shell/PaneWindow.vue
# @4 声明有、宿主开窗路径没吃
grep -n "multiplicity" next/shell/*.mjs next/shell/*.vue next/doctor.mjs
grep -n "noteClaim\|resolveResourceClaim" next/shell/useBoardData.mjs next/shell/viewRegistry.mjs
# 文档选择是全局单格
grep -n "state.selection = {" next/shell/useBoardData.mjs
# 前置件①：没有页面后退栈（openHistoryFor 是版本历史，不是导航历史）
grep -rn "goBack\|history\.back\|navigateBack" next/shell/ || echo "查无此物"
grep -n "function openHistoryFor\|openSection(" next/shell/AppNext.vue
# 前置件②：修饰键只落在本地动作，开窗路径不吃手势
grep -rn "ctrlKey\|metaKey\|altKey\|shiftKey" next/shell/
grep -n "keydown" next/shell/AppNext.vue
grep -rn "auxclick\|button === 1\|middle" next/shell/*.vue || echo "查无此物"
# 自我指控：代码里点名抄 Obsidian 的地方
grep -rn "Obsidian" next/shell/ | head -20
# 真盘现场
node -e "const j=require('D:/Projects/大梦/.pinax/workspace.json');for(const x of Object.values(j.entries))console.log(x.instance,x.z,x.maximized?'MAX':'float',JSON.stringify(x.geometry))"
```

**未做**：真窗口截图（§1.3 的宽度是按 CSS 与默认窗尺寸推算，不是实拍）；未起 Electron；未执行 git；未改任何代码。
