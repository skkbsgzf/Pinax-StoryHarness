# Pinax-Electron-Next 外壳 · 真窗口遍历报告（2026-11-03）

采集环境：Electron 真窗口（`--remote-debugging-port=9333` ＋ Playwright `connectOverCDP`）；数据：《大梦》工作副本 `D:\Projects\大梦`（协议 @3 · 第 6 版）；视口实测 1694×1058。210 步遍历（另 1 条如实 skip）＋ 210 张真截图＋ 9 轮采集，全部为真实运行画面。**本报告不含任何摆拍数据，未提交模型调用，未走原生文件对话框。**

图片用相对路径引用（`../screenshots/next-shell-walkthrough-20261103/`），在 GitHub／VS Code 里正常显示；跨工作区查看请用自包含服务版（`D:/Pinax-main/_tools/walk-report/index.html`）。

## 结论先行（八条）

- **外壳是能用的一整块了，不是拼装中。**竖条六格、索引窗、页签栏、正文／世界书／设定与资料／构思／大纲五种面、命令面板、12 个设置分区、四个标题栏菜单、深浅色——**210 步主路径全部走通，0 次页面报错**（另有 33 步记为失败＝工装没点到或控件按设计禁用，逐条成因见「已知瑕疵」）。主路径（切板 → 开章 → 读／编 → 写作动作 → 查找 → 换形态）没有断点。

- **Obsidian 那味儿的「一块板＝一载体＝一树＋一文档」立住了**：世界书清单 13 条、表格 17 行、条目详情正文里 **11 条蓝链点得动**（点一下真换条目，`113`–`116`）。**但关系图是 13 个节点、0 条连线**，反向链接 chip 在真稿上**一次没出现过**——图和反链这两格在《大梦》上是空转的，根因见「世界书」一节。

- **「1＋N 的多形态切换」目前是通的但有硬伤**：页／分屏／浮窗／最大化／收成标签／关页六档全部实测可用（`27`–`35`、`80`–`81`），**但多扇一起收起时右缘竖排缘签互相压字**——实测 5 扇、6 对重叠、合计 473px，后面那扇点不到（见「专章」）。这是本轮唯一一条**主路径断掉**的新缺陷。

- **窄屏是真问题，不是待验证**：768 档（实测 CSS 903）核心区被压到 **493px** 而助手坞仍占 **360px**——倒挂实锤；同一档下世界书表头叠字、页签全截断、<24×24 控件从 2 涨到 7。

- **设计语言的两处不统一被抓到**：① 顶栏 chip 与设置里都**漏英文内部词**（「大梦 · novel · 第 6 版」「素材 generic」）；② 同一文档标题**同屏出现两次**（实测 2 处，不是账上原先写的 3–4 处）。

- **竖条图标那条旧账被证伪并降级**：原先写「缺省图标必然破图」，实测 12 份清单声明的 icon 值**全部命中**字表 61 键，今天一格没破；真实情况是缺省值 `'plugin'` 是死档（字表无此键），只有将来出现未声明 icon 的 pane 才会破。已回写待办账。

- **批次41 的写作动作带在真窗口里是活的**：聚焦出「续写」、选中一句五档全出（续写／改写／扩写／压缩／润色，实测每枚 48×36）。**但我没点过任何一档**——那会发真模型调用，凭据不在本会话，所以「预览后落位」那段只有源码口径没有实拍。

- **没覆盖的要如实看**：原生文件对话框一律没走（这台机器上 GUI 弹窗对你不可见）、替换与写盘类动作一次没按、四块停用载体板没启用拍面。「已知瑕疵」与「这一轮没覆盖什么」两节是这份报告最该先读的部分。

## 一眼总览

这就是现在的样子：左边一条图标竖条（六格板），紧挨着索引窗（树＋搜索），中间是页签栏＋正文，右边常驻 Pi-Agent 助手坞，顶上一行自绘标题栏带项目 chip 和四个菜单，底下一条状态栏。下面三张是同一套外壳的三种状态，没有摆拍——都是真窗口真数据（《大梦》工作副本）截下来的。

![步骤 95](../screenshots/next-shell-walkthrough-20261103/95-p3-boot-clean.png)

![步骤 177](../screenshots/next-shell-walkthrough-20261103/177-p4-hero-editor.png)

![步骤 178](../screenshots/next-shell-walkthrough-20261103/178-p4-hero-wb.png)

浅色一档、深色一档都完整可用（`139`–`141`、`176`）。竖条特写：`151`，六格图标字形实测都在字表里（详见「已知瑕疵」第 1 条的订正）。

![步骤 151](../screenshots/next-shell-walkthrough-20261103/151-p4-rail-zoom.png)

## 竖条切页：1＋N 的 N 现在长什么样

竖条六格＝小说／大纲／构思／世界书／设定与资料／素材，实测每格 **44×46**（够点）。逐格点过去，状态栏的「载体」字样跟着换，页签栏跟着长出新页——这是切板的主路径，六格全部走通。

![步骤 96](../screenshots/next-shell-walkthrough-20261103/96-p3-board-小说.png)

![步骤 97](../screenshots/next-shell-walkthrough-20261103/97-p3-board-大纲.png)

![步骤 98](../screenshots/next-shell-walkthrough-20261103/98-p3-board-构思.png)

![步骤 99](../screenshots/next-shell-walkthrough-20261103/99-p3-board-世界书.png)

![步骤 120](../screenshots/next-shell-walkthrough-20261103/120-p3-dossier.png)

![步骤 121](../screenshots/next-shell-walkthrough-20261103/121-p3-outline.png)

![步骤 122](../screenshots/next-shell-walkthrough-20261103/122-p3-notes.png)

> **素材板这一格点了像没反应**（`101`／`123`）：图库模板的分支只换板、关索引，不凭空开记录窗（源码注释原话「竖条只负责换板，不替作者凭空开一扇记录窗」，`next/shell/AppNext.vue:1954-1977`）。行为符合裁定，但《大梦》素材记录为 0 时画面不动，只有状态栏从「载体 世界书」变成「载体 素材」——作者看不出发生了什么。已作为「体验待裁」记进待办账。

![步骤 101](../screenshots/next-shell-walkthrough-20261103/101-p3-board-素材.png)

![步骤 123](../screenshots/next-shell-walkthrough-20261103/123-p3-material.png)

## 正文页：开章 → 页签 → 编辑态 → 写作工具 → 写作动作带 → 全书查找

从索引窗树里连点三章，每章在页签栏占一页（`102`–`105`）。正文面默认是**阅读态**（md 渲染过的一篇文），右上角两枚钮是「快捷词」和「编辑」——快捷词开的是写作工具面板（`107`：快捷词／取名两页签，下面「正文提取」把本章高频词直接列成 chip），「编辑」才进 textarea 编辑态。

![步骤 102](../screenshots/next-shell-walkthrough-20261103/102-p3-ch1.png)

![步骤 105](../screenshots/next-shell-walkthrough-20261103/105-p3-tab-reveal.png)

![步骤 106](../screenshots/next-shell-walkthrough-20261103/106-p3-editor.png)

![步骤 107](../screenshots/next-shell-walkthrough-20261103/107-p3-writing-tools.png)

### 写作动作带（批次41 那条链，真窗口里是通的）

源码口径是「动作带跟着写作面走——正文一聚焦就浮现，离开就收起」（`CarrierPaneHost.vue:337-352`，落点 `:1164 data-test="writing-bar"`）。第 7 轮专门补拍，逐条实测：

- 按「编辑」→ textarea 出现（`197`），此时动作带**还没出**——符合设计，它跟的是焦点不是编辑态。

- 点进正文 → 动作带浮现，无选区时只留**「续写」＋「审查本章」**两枚（`198`／`199`）。

- 选中一句 → **「续写／改写／扩写／压缩／润色」五档全出**，实测每枚 48×36（`200`／`201`）。

- 按「取消」退回阅读态，动作带随之收起（`202`）。

![步骤 198](../screenshots/next-shell-walkthrough-20261103/198-p7-band-focus.png)

![步骤 200](../screenshots/next-shell-walkthrough-20261103/200-p7-band-selection.png)

![步骤 201](../screenshots/next-shell-walkthrough-20261103/201-p7-band-zoom.png)

> **这一轮没有点过任何一档动作**：点了就会走 `runtime:complete` 发一次真模型调用，而凭据不在本会话。所以「预览后落位」那段（`writing-result` 的「插入光标处／替换选中段」）本轮**只有源码口径，没有实拍**。

### 全书查找／替换（在索引窗顶部，不是 Ctrl+F）

查一个真人名「柯砂」，实测 **27 处·第 1 处**，命中列表按章分组、带行号与上下文片段（第001章 87／111／123／145…，延迟 5／13／21…），上一处／下一处可跳。面板上还给了「替换为…」与**「替换本章」**两枚写入口——**替换一次都没按**，那是会改稿子的动作。

![步骤 109](../screenshots/next-shell-walkthrough-20261103/109-p3-find.png)

章内分页控件（`data-test="chapter-pager"`，`CarrierPaneHost.vue:1114`）**这一轮没采到**：《大梦》单章长度未触达分页阈值，工装如实记了一条 skip 而不是假装通过。

## 世界书：清单 → 表格 → 关系图 → 详情 → 蓝链 → 分类筛选

这块板是三态视图循环：**清单 → 表格 → 关系图**（`EntriesBoard.vue:38-51`），切换钮的文案写的是「下一个视图」——清单态显示「表」、表格态显示「图」、图态显示「列」（`:55-59`）。停在哪个态按项目持久化（`:42-46` 读 `readEntriesView(projectRoot)`）。

> **先订正一处第 3 轮的错账**：那轮把进板的第一格命名成「图视图」并量出「关系图 0 节点」，实际画面是**清单态**（同一步的 `treeRows=13` 才是真相），整个前 7 轮**一次都没拍到关系图**。那个 0 是「图根本没渲染」的产物，不是「图是空的」。第 8 轮按源码类名重测，下面这组数才是关系图的实测。

![步骤 204](../screenshots/next-shell-walkthrough-20261103/204-p8-wb-back-to-list.png)

![步骤 205](../screenshots/next-shell-walkthrough-20261103/205-p8-wb-table-again.png)

### 关系图实测：13 个节点、0 条连线

切到图态后：SVG 画布实测 **922×340**，节点 **13** 个（径向布局：正常时圆心＝入度最高的条目、连不进生成树的点标孤点沿外圈均分角度，`entriesView.mjs:254-319`。**0 条边时入度全 0，选根退化成按清单序取第一条**，其余 12 点全标 `isolate` 排成一圈——这就是 `206` 画面看着像散点环的原因），图例按类别出 **3** 档（类色取自 token：var(--accent) / var(--accent-teal) / var(--accent-amber)；图例文案 编年人物设定），节点标签就是条目全名（前几个：「编年史·碎界以来（务虚学会秘录）」、「人物·柯秒（冷穿越剧版）」、「剧作·插叙结构」、「剧作·世界观讲述原则」）。**连线 0 条**。

![步骤 206](../screenshots/next-shell-walkthrough-20261103/206-p8-wb-graph-real.png)

![步骤 207](../screenshots/next-shell-walkthrough-20261103/207-p8-wb-graph-hover.png)

**0 连线不是图坏了，是这张图上没有可读的关系**：边只来自条目 frontmatter 的 `relations[].to`（`EntryGraph.vue:11` 注释原话「边＝relations[].to」，解析在 `entriesView.mjs` 的 `entryEdges`），而《大梦》工作副本 13 条世界书条目的 `relations` **逐条都是空数组**（`世界书/*/*.md` 第 17 行，13/13 命中）。所以对作者来说，这一格现在是一张**散点图**：点得动、能按类别认色，但看不出谁连着谁。

### 详情、蓝链、反向链接

点一行／一个节点进详情，正文里出现的词条渲染成蓝链——实测**可见蓝链 11 条**，点一条真的换条目（`115` 的标题从「编年史·碎界以来」变成「真相层·大世界与三组织」，蓝链数随之变 15）。分类下拉与筛选框可按 编年／人物／设定 精投：筛「柯」时表格从 17 行降到 **3 行**（`117`–`119`）。

![步骤 115](../screenshots/next-shell-walkthrough-20261103/115-p3-wb-link.png)

![步骤 116](../screenshots/next-shell-walkthrough-20261103/116-p3-wb-backlinks.png)

![步骤 113](../screenshots/next-shell-walkthrough-20261103/113-p3-wb-detail.png)

![步骤 114](../screenshots/next-shell-walkthrough-20261103/114-p3-wb-meta.png)

![步骤 117](../screenshots/next-shell-walkthrough-20261103/117-p3-wb-cat.png)

![步骤 118](../screenshots/next-shell-walkthrough-20261103/118-p3-wb-filter.png)

**反向链接 chip 在真稿上从未出现**（此前账上写「详情底部给反向链接 chip」是照源码写的，实测不成立，已订正）：挂载条件是 `entryBacklinks.length`（`EntryDetailPanel.vue:299`），而 `computeBacklinks` 只认两件事——别的条目 `relations` 指到我，或别的条目**正文里含我的条目全名**（`wikiLinks.mjs:106-119`）。`relations` 全空已述；13 个全名彼此**零提及**（在 `世界书/` 下逐个全名反查，13/13 命中 0 个其他文件）。整轮 210 步里 `backlinkChips` 读数恒为 0。

**三条关系轨要分清**：① 正文蓝链走「全名＋短名＋keys＋tags」那张词表，**这一轨在《大梦》是活的**（11 条可见蓝链）；② 关系图只走 `relations[]`，**空**；③ 反向链接走 `relations[]` 或全名整串包含，**空**。也就是说：稿子里的互相引用只被渲染成了可点的字，没有汇成任何一张图或一份「谁提到我」。这是数据口径与功能口径没对齐，不是渲染 bug——要不要让 ②③ 也吃 ① 的词表，得作者裁（已进待办账待裁定 11）。

![步骤 208](../screenshots/next-shell-walkthrough-20261103/208-p9-wb-entry-edit.png)

![步骤 209](../screenshots/next-shell-walkthrough-20261103/209-p9-wb-meta-relations.png)

> **关系的录入面在哪一层（第 9 轮实拍）**：面是**有的**——条目右上「编辑」→ 展开「条目信息」→ `关系` 区，一行三格（目标／类型／立场）＋「暗线」勾选＋「删行」，底下「加一条关系」（`EntryDetailPanel.vue:222-268`，目标格带 `datalist` 自动补全条目名）。但它在**两层折叠之后**，且入口文案只写「条目信息 关键词 0 · 关系 0」（`209` 实测）。拍完按「取消」退回阅读态，**没有保存、没有写盘**（`210`）。所以「图为什么是散点」的另一半答案是：**《大梦》13 条里 0 条填过关系**。

## 形态切换：页 / 分屏 / 浮窗 / 最大化 / 收起 / 关页

这是作者最关心的一族操作，全部走右键菜单与页签栏，不藏快捷键。逐条实测：把一页分出去（`27`）、转浮窗（`28`）、拖动浮窗（`29`）、最大化（`30`）、收成标签（`32`）、侧组页签展开（`33`）、关一页（`35`）、移回主页组（`80`–`81`）。

![步骤 27](../screenshots/next-shell-walkthrough-20261103/27-form-split.png)

![步骤 28](../screenshots/next-shell-walkthrough-20261103/28-form-float.png)

![步骤 29](../screenshots/next-shell-walkthrough-20261103/29-float-drag.png)

![步骤 30](../screenshots/next-shell-walkthrough-20261103/30-float-maximize.png)

![步骤 32](../screenshots/next-shell-walkthrough-20261103/32-form-tab.png)

![步骤 35](../screenshots/next-shell-walkthrough-20261103/35-page-close.png)

![步骤 80](../screenshots/next-shell-walkthrough-20261103/80-p2-split-out.png)

![步骤 81](../screenshots/next-shell-walkthrough-20261103/81-p2-split-back.png)

> **唯一一次「失败」其实是正确行为**：步骤 `34` 想再点一次「停靠」，但页面已经在页态，菜单里那项按设计就是灰的（`PaneFormMenu.vue` 的 disabled 判定），工装记成 click 超时。同类还有 `54`–`57`（标题栏菜单用 `locator.click()` 打不开，改用 DOM click 后 147–150 全部弹出成功）——那是测试工装的手感问题，不是产品的，报告里分开记。

## 索引窗：收起 / 展开 / 拖宽

索引窗可整栏收起（`124`）、展开（`125`）、拖分隔条改宽（`126`，实测宽度跟着变）。窄屏下它会自动收起，见「窄屏」一节。

![步骤 124](../screenshots/next-shell-walkthrough-20261103/124-p3-index-collapse.png)

![步骤 125](../screenshots/next-shell-walkthrough-20261103/125-p3-index-expand.png)

![步骤 126](../screenshots/next-shell-walkthrough-20261103/126-p3-index-resize.png)

## 命令面板：77 条命令、查询、空态、执行

`Ctrl+K` 开面板，实测在册 **77 条**（顶栏提示「应用菜单／载体命令／当前页动作」三类）。查询走纯子串匹配（`CommandPalette.vue:34-47`），无模糊、无拼音——所以中文里搜「世界」能中，搜「shijie」不中。执行一条「切换主题」真的换了配色（`130`），执行第二条把构思页的文档换成「项目总览」（`131`，页签标题当场跟着变）。

![步骤 127](../screenshots/next-shell-walkthrough-20261103/127-p3-palette-open.png)

![步骤 128](../screenshots/next-shell-walkthrough-20261103/128-p3-palette-q1.png)

![步骤 129](../screenshots/next-shell-walkthrough-20261103/129-p3-palette-q2.png)

![步骤 130](../screenshots/next-shell-walkthrough-20261103/130-p3-palette-exec.png)

![步骤 131](../screenshots/next-shell-walkthrough-20261103/131-p3-palette-exec2.png)

## 设置：12 个分区逐屏实拍

设置是统一二级页（模态），左目录分组、右表单。逐分区实拍：**偏好与模型／备份与恢复／服务与通知／载体管理／导入既有稿／新建项目／主载体选择／文档历史／提案审阅／导出／大纲转换**，加搜索与空命中态。三处值得作者看的实测读数：

- **载体管理**（`182`）：12 块载体全列出，带权限串（`file:正文.rw, agent.task`）与工具数（小说 8、世界书 3、设定与资料 6…），主载体那枚「停用」按钮按设计置灰。

- **主载体选择**（`185`）：中文标题后面**直接跟着英文 kind**——「小说 novel」「剧本 screenplay」「素材 generic」，和顶栏 chip 是同一处外泄（已记 批次74 任务1）。

- **搜索口径**（`191`）：搜「字号」时左目录报「无匹配设置」，右栏却仍显示含「正文字号」的那一节。源码自陈这是有意的（`SettingsModal.vue:103`「搜索不过滤当前节」，`:110-114` 只比分区标题与 keywords，不读字段标签）。意图没问题，反馈自相矛盾这件事有。

![步骤 179](../screenshots/next-shell-walkthrough-20261103/179-p5-settings-open.png)

![步骤 180](../screenshots/next-shell-walkthrough-20261103/180-p5-set-backup.png)

![步骤 181](../screenshots/next-shell-walkthrough-20261103/181-p5-set-services.png)

![步骤 182](../screenshots/next-shell-walkthrough-20261103/182-p5-set-carriers.png)

![步骤 183](../screenshots/next-shell-walkthrough-20261103/183-p5-set-import.png)

![步骤 184](../screenshots/next-shell-walkthrough-20261103/184-p5-set-newProject.png)

![步骤 185](../screenshots/next-shell-walkthrough-20261103/185-p5-set-primary.png)

![步骤 186](../screenshots/next-shell-walkthrough-20261103/186-p5-set-history.png)

![步骤 187](../screenshots/next-shell-walkthrough-20261103/187-p5-set-proposals.png)

![步骤 188](../screenshots/next-shell-walkthrough-20261103/188-p5-set-export.png)

![步骤 189](../screenshots/next-shell-walkthrough-20261103/189-p5-set-outline-import.png)

![步骤 191](../screenshots/next-shell-walkthrough-20261103/191-p5-settings-search.png)

![步骤 192](../screenshots/next-shell-walkthrough-20261103/192-p5-settings-search-none.png)

## 标题栏四个菜单：项目 / 编辑 / 设置 / 帮助

四个菜单全部弹出成功（前一轮用 `locator.click()` 打不开，换 DOM click 后复现正常——是工装手感，不是产品缺陷）。实测条目：项目 8 条（新建／打开文件夹／导入／备份恢复／当前文档历史／提案审阅／打开提案目录／退出，全部可用），设置 3 条（偏好与模型／载体管理／切换明暗主题），编辑与帮助见 `148`／`150`。

![步骤 147](../screenshots/next-shell-walkthrough-20261103/147-p4-menu-项目.png)

![步骤 148](../screenshots/next-shell-walkthrough-20261103/148-p4-menu-编辑.png)

![步骤 149](../screenshots/next-shell-walkthrough-20261103/149-p4-menu-设置.png)

![步骤 150](../screenshots/next-shell-walkthrough-20261103/150-p4-menu-帮助.png)

## Pi-Agent 助手坞：常驻右栏的会话面

右栏常驻 **360px** 宽的助手坞：顶部「会话 1／审阅」两枚钮，中间是上一轮真模型跑出来的审稿结论（审阅意见／可执行动作／过程／工具面四段折叠），底部输入框「就当前项目问一句话…」。**这一轮没有提交任何新的模型调用**（凭据不在本会话），所以画面里的结论是历史会话回放，不是本次生成。

![步骤 173](../screenshots/next-shell-walkthrough-20261103/173-p4-dock-review.png)

![步骤 174](../screenshots/next-shell-walkthrough-20261103/174-p4-dock-input-focus.png)

![步骤 175](../screenshots/next-shell-walkthrough-20261103/175-p4-dock-clear.png)

坞顶还压着一条写盘模式提示「自动模式下，AI 的产出会直接写入正文，不再走提案。只对当前项目生效。〔确认切换〕〔取消〕」——批次37 的 writeMode 三档在真窗口里是有出口的（`179` 起每张设置图右上角都可见）。

## 深浅色与窄屏

深色（`139`／`140`）与浅色（`141`／`176`）都完整，切主题走的是设置里的「切换明暗主题」和命令面板两条路，结果一致。

![步骤 139](../screenshots/next-shell-walkthrough-20261103/139-p3-dark-shell.png)

![步骤 140](../screenshots/next-shell-walkthrough-20261103/140-p3-dark-wb.png)

### 窄屏：先说前提，再给读数

**前提**：Electron 建窗是 1440×900（`next/shell/main.mjs:330-341`），但实测 `innerWidth` 恒为请求值的 **1.176 倍**（要 1024 实测 1204、要 768 实测 903、要 390 实测 458）——差值来自 uiZoom。所以下面这三档**都不是字面意义的 1024／768／390**，任何按像素下的窄屏判据要先解决这个换算。

| 请求档 | 实测 innerWidth | 核心区宽 | 助手坞宽 |

![步骤 142](../screenshots/next-shell-walkthrough-20261103/142-p3-narrow-1024.png)

![步骤 143](../screenshots/next-shell-walkthrough-20261103/143-p3-narrow-768.png)

![步骤 144](../screenshots/next-shell-walkthrough-20261103/144-p3-narrow-390.png)

## 专章 · 收起态缘签压字（本轮新发现，未开单）

一扇页收成「标签」态后，界面同时给两处入口：页签栏里那条带「标签」角标的页签，和核心区右缘一枚竖排小缘签。缘签的排布是**固定步长**——`next/shell/PaneWindow.vue:78` 写 `top: 120 + tabIndex * 36`，可它的**高度是竖排标题自己撑出来的**（68–211px 不等）。5 扇一起收起时，实测：

| 缘签（pane） | top（实测） | 高（实测） | bottom | 竖排标题 |
| --- | --- | --- | --- | --- |
| novel.editor | 216 | 108 | 324 | 正文 · 003-倒带 |
| outline.editor | 252 | 68 | 320 | 大纲编辑 |
| notes.editor | 288 | 135 | 423 | 构思编辑 · 项目总览 |
| dossier.editor | 324 | 211 | 535 | 资料与约束 · 开篇参考-哪吒讲古 |
| worldbook.entries | 360 | 194 | 555 | 条目 · 真相层·大世界与三组织 |

步长 36px、签高最大 211px，于是相邻签两两压字。实测 **6 对重叠、合计 473px**：

| 与 | 被压 | 重叠 |
| --- | --- | --- |
| novel.editor | outline.editor | 68px |
| novel.editor | notes.editor | 36px |
| outline.editor | notes.editor | 32px |
| notes.editor | dossier.editor | 99px |
| notes.editor | worldbook.entries | 63px |
| dossier.editor | worldbook.entries | 175px |

![步骤 194](../screenshots/next-shell-walkthrough-20261103/194-p6-tab-rail-overlap.png)

![步骤 195](../screenshots/next-shell-walkthrough-20261103/195-p6-tab-rail-zoom.png)

**为什么这条要紧**：它不是审美问题。叠住的签点不到后面那扇，「收起 → 还原」这条主路径在多扇收起时是断的；而门禁不但不拦，还把这套算术锁死了——`next/tests/shell-ui.spec.mjs:2586` 直接断言 `top: 120px`，`visual-contract.test.mjs:521-523` 只闸层序不闸排布。修法两案（步长按实测签高累加／缘签退化成图标＋悬浮出标题），但「缘签要不要跟页签栏并存」是设计裁定，已列入待裁定第 10 条，作者点头前不动。

## 已知瑕疵（如实列，不粉）

- **顶栏项目 chip 漏英文内部词**：实测读作「大梦 · novel · 第 6 版」，`novel` 是内部载体 id（拼接点 `AppNext.vue:646`）。设置「主载体选择」里 12 块载体同样带英文 kind。已记 批次74 任务1。

- **同一文档标题同屏出现两次**：实测三种组合——`span.workspace-nav-label + h2.doc-title`（正文页）、`span.nx-page-tab-label + span.nx-pane-window-title`（页签＋窗题）、`td.nx-entries-name + h2.doc-title`（世界书列表＋详情）。**订正**：待办账原先按静态打印点数成「3–4 处」，真窗口同屏只有 2 处，量级和改法都不一样，已回写。

- **收起态缘签压字**：见专章，本轮新发现。

- **小命中区仍在**：逐屏实测 **<24×24 有 2–7 个、<44×44 有 9–28 个**（随板别浮动）。点名到的：`关闭这一页` 20×36、`快捷词` 45×22、审阅模式徽标 40×23、`新建资料` 22×22、世界书表头 5 枚「按 X 排序」20–21×36（宽不到 24，可点区只剩图标）、设定与资料板 3 行可点链接行整行高仅 19px。

- **素材板点了像没反应**：见「竖条切页」，行为符合裁定但缺空态出口。

- **设置搜索反馈自相矛盾**：见「设置」。

- **390 档顶栏挤压**：项目 chip 与「帮助」菜单文字视觉相撞（`144`）。

- **三张图的「步骤名」与画面不符，如实标出**：步骤 `19` 记的是「写作动作条（续写/改写/…）」，但当时工装没真进编辑态，画面是浅色下的四扇浮窗级联——真正的动作带在第 7 轮补拍（`196`–`202`）里；步骤 `190` 想进「载体详情（pinax.carrier.novel）」，实拍停在「偏好与模型」，分区没切过去；**步骤 `111` 记的是「世界书：图视图」，实拍是清单视图**——根因是切换钮文案指「下一个视图」而工装以为它指「当前视图」（`EntriesBoard.vue:55-59`），连带把「0 节点」这个假读数写进了账。第 8 轮（`203`–`207`）已按源码类名重拍重测。这条还连带暴露一个工装坑：**步骤名不许带冒号**——`190`／`165` 的文件名里的冒号被 Windows 当成 NTFS 备用数据流，两张图一度落成 0 字节，已用 `_tools/ads-recover.ps1` 从流里取回并改名。

- **关系图与反向链接在真稿上空转**：图 13 节点 0 连线、反链 chip 恒为 0，成因与「三条关系轨」的口径见「世界书」一节。**代码没坏，是数据喂不出关系**——但作者点开这一格看到的是散点，功能价值等于没有。要不要让图与反链也吃正文蓝链那张词表，属**待作者裁**。

- **210 步里 33 步记为失败**（失败＝工装没点到／控件按设计禁用，**不是页面报错**）：逐条回看过，成因分三类——① 目标本来就按设计禁用（如页态再点「停靠」）；② 工装点击手感（标题栏菜单 `locator.click()` 打不开，DOM click 可用；后续轮次已改）；③ 上一轮遗留的多窗状态挡住控件（浮窗叠在核心区上，先清浮窗后复测通过）。**没有一条是页面报错**：整轮 `pageerror` 计数 0。

## 这一轮没覆盖什么（边界要说清）

- **原生系统对话框一律没走**：打开项目文件夹、新建项目、导入既有稿、导出、备份恢复的选路弹窗。这台机器上 GUI 弹窗对作者不可见，点了等于把会话挂住，所以只拍到菜单项与设置分区，**没有真按过确定**。

- **没有提交任何模型调用**：凭据不在本会话。助手坞里看到的审稿结论是历史会话落盘的回放；写盘模式提示条可见但没点「确认切换」；**写作动作带的「预览 → 插入光标处／替换选中段」整段没有实拍**（`196`–`202` 只拍到动作带出现与五档按钮齐出，没按）。

- **章内分页控件未采到**：《大梦》单章未触达分页阈值（工装记了 skip）。

- **联机／漫画／视频／体验四块板**：本轮只在设置「载体管理」里看到它们处于停用态，没有启用后拍面（启用会改工作副本的载体清单，超出「看现状」的范围）。

- **拖拽改页序、跨组拖页**：未测。

- **窄屏像素级判据**：因 uiZoom 换算未解决，本轮只给定性结论。

另外两条状态交代：`D:\Projects\大梦\.pinax\workspace.json` 在开跑前是脏的（上一会话遗留 4 扇浮窗＋2 页收成标签），已备份到 `_tools/workspace-dirty-backup.json` 后重置为干净启动态；跑完这 9 轮它还是脏的，且是**最后一轮的现场**：6 扇窗（4 扇收成标签、当前停在世界书关系图态，视图选择按项目持久化在浏览器存储而非这份 json 里）。专章那张 5 扇收起态的取证图来自第 6 轮当时的状态，收尾时已归位到 4 扇。**第 8／9 轮（`203`–`210`）只点视图切换、悬停与「取消」，一次没按保存**。原稿目录 `C:\Users\Administrator\D盘归档\…\大梦` 全程只读，一个字没动。**本轮没有 commit、没有 push。**

## 复现方式（命令级）

```bash
# 1) 起真窗口（换端口，不与并行会话抢）
PINAX_NEXT_ROOT="D:/Projects/大梦" \
  npx electron next/shell/main.cjs --remote-debugging-port=9333 > /dev/null 2>&1 &
# 旧 electron.exe 会抢 CDP 端口，先定位再杀：
powershell -File D:/Pinax-main/_tools/ps-list-electron.ps1

# 2) 五轮遍历（Playwright connectOverCDP，逐屏截图 + DOM 读数）
node scripts/tmp-next-shell-walkthrough-capture.mjs    # 001-067
node scripts/tmp-next-shell-walkthrough-capture2.mjs   # 068-094
node scripts/tmp-next-shell-walkthrough-capture3.mjs   # 095-146 干净启动态正式遍历
node scripts/tmp-next-shell-walkthrough-capture4.mjs   # 147-178 菜单/竖条/明暗
node scripts/tmp-next-shell-walkthrough-capture5.mjs   # 179-193 设置逐分区
node scripts/tmp-next-shell-walkthrough-capture6.mjs   # 194-195 缘签重叠取证
node scripts/tmp-next-shell-walkthrough-capture7.mjs   # 196-202 写作动作带补拍
node scripts/tmp-next-shell-walkthrough-capture8.mjs   # 203-207 世界书关系图重测（订正 111）
node scripts/tmp-next-shell-walkthrough-capture9.mjs   # 208-210 关系录入面实拍（不保存）

# 3) 读数账本
#   步骤流水：D:/Pinax-main/_tools/walk-manifest.json（205 条记录 / 编号至 207，含 1 条 skip）
#   缘签实测：D:/Pinax-main/_tools/tab-rail-evidence.json
# 4) 报告生成（HTML 服务版 + md 入库版）
node scripts/tmp-walk-report-build.mjs

```

截图原图在 `docs/screenshots/next-shell-walkthrough-20261103/`（210 张），入库版文档在 `docs/plan/next-shell-walkthrough-showcase-20261103.md`。

## 附录 · 210 步全量流水

| # | 步骤 | 做了什么 | 结果 |
| --- | --- | --- | --- |
| 1 | `00-boot` | 真项目加载后的第一眼（上次会话的浮窗级联原样恢复） | ok |
| 2 | `boot-chrome` | 浮窗 chrome：收起为侧缘标签（逐张收） | ok |
| 3 | `boot-restored-clean` | 收干净后的核心区（页态只剩一张） | ok |
| 4 | `side-tabs-open` | 侧缘标签：点「展开」把它拉回页面 | ok |
| 5 | `rail-小说` | 竖条切页：小说 | ok |
| 6 | `rail-大纲` | 竖条切页：大纲 | ok |
| 7 | `rail-构思` | 竖条切页：构思 | ok |
| 8 | `rail-世界书` | 竖条切页：世界书 | ok |
| 9 | `rail-设定与资料` | 竖条切页：设定与资料 | ok |
| 10 | `rail-素材` | 竖条切页：素材 | ok |
| 11 | `novel-open-board` | 回到正文载体（小说） | ok |
| 12 | `chapter-01` | 左树点第一章 → 正文页 | ok |
| 13 | `chapter-02` | 左树点第二章（多页态） | ok |
| 14 | `chapter-03` | 左树点第三章（页签栏三条） | ok |
| 15 | `editor-caret` | 进编辑态（textarea 落点） | ok |
| 16 | `writing-tools` | 写作工具面板展开 | ok |
| 17 | `writing-tools-names` | 写作工具·人名页签 | ok |
| 18 | `writing-tools-words` | 写作工具·快捷词页签 | ok |
| 19 | `writing-bar` | 写作动作条（续写/改写/扩写/压缩/润色入口） | ok |
| 20 | `writing-tools-close` | 收起写作工具 | ok |
| 21 | `find-open` | 索引窗「全书查找」展开 | ok |
| 22 | `find-query` | 查一个真词（大梦里的人名） | ok |
| 23 | `find-close` | 收起查找 | ok |
| 24 | `chapter-contextmenu` | 章节行右键 | ok |
| 25 | `chapter-contextmenu-esc` | 右键菜单 Esc 收起 | ok |
| 26 | `tab-contextmenu` | 页签右键 → 形态菜单 | ok |
| 27 | `form-split` | 形态：移到侧页组（对半） | ok |
| 28 | `form-float` | 形态：浮出为窗 | ok |
| 29 | `float-drag` | 浮窗拖一下（拖拽句柄） | ok |
| 30 | `float-maximize` | 浮窗双击标题 → 最大化 | ok |
| 31 | `float-restore` | 再双击收回 | ok |
| 32 | `form-tab` | 形态：收成侧缘标签 | ok |
| 33 | `side-tab-expand` | 侧缘标签点「展开」回到页面 | ok |
| 34 | `form-dock-back` | 形态：占为页（收回主组） | FAIL |
| 35 | `page-close` | 关掉一页（页签 ×） | ok |
| 36 | `index-collapse` | 索引窗收起 | FAIL |
| 37 | `index-expand` | 再点竖条把索引窗拉回来 | ok |
| 38 | `worldbook-board` | 切到世界书（世界书） | ok |
| 39 | `worldbook-view-toggle` | 世界书：图/表视图切换 | FAIL |
| 40 | `worldbook-table` | 世界书：表格态 | ok |
| 41 | `worldbook-entry` | 表格点一条 → 右详情（元信息/关系/反向链接） | FAIL |
| 42 | `worldbook-wikilink` | 详情里的蓝链点一下（跳条目） | FAIL |
| 43 | `worldbook-category-filter` | 类别树筛一格 | ok |
| 44 | `worldbook-search` | 条目过滤框输入 | ok |
| 45 | `worldbook-search-clear` | 过滤清空 | ok |
| 46 | `board-大纲` | 载体面：大纲 | ok |
| 47 | `board-构思` | 载体面：构思 | ok |
| 48 | `board-设定与资料` | 载体面：设定与资料 | ok |
| 49 | `board-素材` | 载体面：素材 | ok |
| 50 | `palette-open` | Ctrl+P 开命令面板 | ok |
| 51 | `palette-query` | 输入「导出」看命中 | ok |
| 52 | `palette-query-empty` | 无命中态（乱码串） | ok |
| 53 | `palette-close` | Esc 收起（不执行动作） | ok |
| 54 | `menu-settings` | 标题栏「设置」菜单展开 | ok |
| 55 | `menu-settings-item` | 点「偏好与模型…」 | FAIL |
| 56 | `settings-search-hit` | 设置搜索框输入一个词 | FAIL |
| 57 | `settings-close` | 关闭设置页 | ok |
| 58 | `assistant-dock` | 右侧 Agent 对话面（不调模型） | ok |
| 59 | `theme-dark` | 切深色 | ok |
| 60 | `theme-dark-worldbook` | 深色下的世界书面 | ok |
| 61 | `theme-dark-editor` | 深色下的正文面 | ok |
| 62 | `theme-light` | 切回明亮 | ok |
| 63 | `narrow-1024` | 视口收到 1024px | ok |
| 64 | `narrow-768` | 视口收到 768px | ok |
| 65 | `narrow-390` | 视口收到 390px | ok |
| 66 | `wide-back` | 视口恢复 1440 | ok |
| 67 | `final-state` | 遍历结束时的状态（会写进 workspace.json） | ok |
| 68 | `p2-clear-floats` | 把在册浮窗逐张收成侧缘标签（窗头「收起」钮） | ok |
| 69 | `p2-clean-center` | 核心区只剩一张页 | ok |
| 70 | `p2-novel-board` | 回小说板（索引窗展开态） | ok |
| 71 | `p2-index-collapse` | 索引窗收起钮 | FAIL |
| 72 | `p2-index-expand` | 再点竖条把索引窗拉回来 | ok |
| 73 | `p2-worldbook` | 切到世界书 | ok |
| 74 | `p2-wb-view-toggle` | 图/表切换 → 表格视图 | FAIL |
| 75 | `p2-wb-row` | 表格点一行 → 右详情 | FAIL |
| 76 | `p2-wb-meta` | 详情：元信息折叠钮 | ok |
| 77 | `p2-wb-wikilink` | 详情里的蓝链 → 跳条目 | FAIL |
| 78 | `p2-wb-backlinks` | 反向链接区 | ok |
| 79 | `p2-wb-graph` | 切回图视图 | FAIL |
| 80 | `p2-split-out` | 正文页 → 移到侧页组（对半） | ok |
| 81 | `p2-split-back` | 窗头「移回主页组」 | FAIL |
| 82 | `p2-settings-open` | 标题栏 设置 → 偏好与模型…（一次点到底） | FAIL |
| 83 | `p2-settings-search` | 设置搜索：输入「字号」 | FAIL |
| 84 | `p2-settings-close` | Esc 关闭设置 | ok |
| 85 | `p2-carriers-panel` | 设置 → 载体管理… | ok |
| 86 | `p2-carriers-close` | 关闭 | ok |
| 87 | `p2-history` | 项目 → 当前文档历史… | FAIL |
| 88 | `p2-history-close` | 关闭历史面 | ok |
| 89 | `p2-palette-run` | 面板里执行「切换明暗主题」这类只读命令 | ok |
| 90 | `p2-palette-exec` | 回车执行 | ok |
| 91 | `p2-palette-revert` | 再执行一次切回来 | FAIL |
| 92 | `p2-narrow-768` | 视口 768px | ok |
| 93 | `p2-narrow-390` | 视口 390px | ok |
| 94 | `p2-wide-back` | 回 1440 | ok |
| 95 | `p3-boot-clean` | 清掉 workspace.json 后重启的第一眼（缺省页） | ok |
| 96 | `p3-board-小说` | 竖条切页 → 小说 | ok |
| 97 | `p3-board-大纲` | 竖条切页 → 大纲 | ok |
| 98 | `p3-board-构思` | 竖条切页 → 构思 | ok |
| 99 | `p3-board-世界书` | 竖条切页 → 世界书 | ok |
| 100 | `p3-board-设定与资料` | 竖条切页 → 设定与资料 | ok |
| 101 | `p3-board-素材` | 竖条切页 → 素材 | ok |
| 102 | `p3-ch1` | 正文：点第一章 | ok |
| 103 | `p3-ch2` | 正文：点第二章（两页在册） | ok |
| 104 | `p3-ch3` | 正文：点第三章（三页在册） | ok |
| 105 | `p3-tab-reveal` | 页签栏：点回第一章那张页签 | ok |
| 106 | `p3-editor` | 正文编辑态（textarea 落点） | ok |
| 107 | `p3-writing-tools` | 写作工具面（词频/人名） | ok |
| 108 | `p3-writing-close` | 收起写作工具 | ok |
| 109 | `p3-find` | 全书查找：查「柯秒」 | ok |
| 110 | `p3-find-close` | 收起查找 | ok |
| 111 | `p3-wb-graph` | 世界书：图视图 | ok |
| 112 | `p3-wb-table` | 世界书：切表格视图 | ok |
| 113 | `p3-wb-detail` | 表格点一条 → 右详情 | ok |
| 114 | `p3-wb-meta` | 详情：元信息展开 | ok |
| 115 | `p3-wb-link` | 详情：点蓝链跳条目 | ok |
| 116 | `p3-wb-backlinks` | 详情：反向链接区 | ok |
| 117 | `p3-wb-cat` | 类别树切一格（人物） | ok |
| 118 | `p3-wb-filter` | 条目过滤框 | ok |
| 119 | `p3-wb-filter-clear` | 过滤清空 | ok |
| 120 | `p3-dossier` | 设定与资料：点一篇资料 | ok |
| 121 | `p3-outline` | 大纲：点一个节点 | ok |
| 122 | `p3-notes` | 构思：点一条构思 | ok |
| 123 | `p3-material` | 素材：图库模板 + 点一张卡 | ok |
| 124 | `p3-index-collapse` | 索引窗收起 | ok |
| 125 | `p3-index-expand` | 点竖条拉回来 | ok |
| 126 | `p3-index-resize` | 拖索引窗右缘改宽 | ok |
| 127 | `p3-palette-open` | Ctrl+P 开面板 | ok |
| 128 | `p3-palette-q1` | 查「导出」 | ok |
| 129 | `p3-palette-q2` | 查「主题」 | ok |
| 130 | `p3-palette-exec` | 回车执行（切主题） | ok |
| 131 | `p3-palette-exec2` | 再执行一次切回来 | ok |
| 132 | `p3-settings-open` | 设置 → 偏好与模型… | FAIL |
| 133 | `p3-settings-search` | 设置搜索「字号」 | FAIL |
| 134 | `p3-settings-close` | Esc 关设置 | ok |
| 135 | `p3-carriers` | 设置 → 载体管理… | ok |
| 136 | `p3-carriers-close` | 关设置 | ok |
| 137 | `p3-history` | 项目 → 当前文档历史… | FAIL |
| 138 | `p3-history-close` | 关历史面 | ok |
| 139 | `p3-dark-shell` | 切深色（小说板） | ok |
| 140 | `p3-dark-wb` | 深色下的世界书 | ok |
| 141 | `p3-light-again` | 切回明亮 | ok |
| 142 | `p3-narrow-1024` | 视口 1024px | ok |
| 143 | `p3-narrow-768` | 视口 768px | ok |
| 144 | `p3-narrow-390` | 视口 390px | ok |
| 145 | `p3-wide-back` | 回 1440 | ok |
| 146 | `p3-final` | 遍历结束态 | ok |
| 147 | `p4-menu-项目` | 标题栏菜单「项目」弹出态 | ok |
| 148 | `p4-menu-编辑` | 标题栏菜单「编辑」弹出态 | ok |
| 149 | `p4-menu-设置` | 标题栏菜单「设置」弹出态 | ok |
| 150 | `p4-menu-帮助` | 标题栏菜单「帮助」弹出态 | ok |
| 151 | `p4-rail-zoom` | 竖条整列特写（图标字形核对） | ok |
| 152 | `p4-rail-glyphs` | 竖条每格的 svg 字形统计 | ok |
| 153 | `p4-settings-prefs` | 设置 → 偏好与模型… | ok |
| 154 | `p4-set-prefs` | 设置分区：偏好与模型 | ok |
| 155 | `p4-set-backup` | 设置分区：备份与恢复 | FAIL |
| 156 | `p4-set-services` | 设置分区：服务与通知 | FAIL |
| 157 | `p4-set-carriers` | 设置分区：载体管理 | FAIL |
| 158 | `p4-set-import` | 设置分区：导入既有稿 | FAIL |
| 159 | `p4-set-newProject` | 设置分区：新建项目 | FAIL |
| 160 | `p4-set-primary` | 设置分区：主载体选择 | FAIL |
| 161 | `p4-set-history` | 设置分区：文档历史 | FAIL |
| 162 | `p4-set-proposals` | 设置分区：提案审阅 | FAIL |
| 163 | `p4-set-export` | 设置分区：导出 | FAIL |
| 164 | `p4-set-outline-import` | 设置分区：大纲转换 | FAIL |
| 165 | `p4-set-carrier:pinax.carrier.n` | 设置分区：写作偏好 | FAIL |
| 166 | `p4-settings-search` | 设置搜索「字号」 | FAIL |
| 167 | `p4-settings-search-none` | 设置搜索无命中 | FAIL |
| 168 | `p4-settings-close` | Esc 关设置 | ok |
| 169 | `p4-history` | 项目 → 当前文档历史… | ok |
| 170 | `p4-history-close` | 关历史面 | ok |
| 171 | `p4-proposals` | 项目 → 提案审阅… | ok |
| 172 | `p4-proposals-close` | 关提案面 | ok |
| 173 | `p4-dock-review` | Pi-Agent 头部「审阅」钮态 | ok |
| 174 | `p4-dock-input-focus` | 对话输入框聚焦（不发送） | ok |
| 175 | `p4-dock-clear` | 清空输入框 | ok |
| 176 | `p4-light-mode` | 切回明亮（若已是明亮则跳过） | ok |
| 177 | `p4-hero-editor` | 明亮：小说板 + 正文页 | ok |
| 178 | `p4-hero-wb` | 明亮：世界书 + 条目详情 | ok |
| 179 | `p5-settings-open` | 设置 → 偏好与模型… | ok |
| 180 | `p5-set-backup` | 设置分区：备份与恢复 | ok |
| 181 | `p5-set-services` | 设置分区：服务与通知 | ok |
| 182 | `p5-set-carriers` | 设置分区：载体管理 | ok |
| 183 | `p5-set-import` | 设置分区：导入既有稿 | ok |
| 184 | `p5-set-newProject` | 设置分区：新建项目 | ok |
| 185 | `p5-set-primary` | 设置分区：主载体选择 | ok |
| 186 | `p5-set-history` | 设置分区：文档历史 | ok |
| 187 | `p5-set-proposals` | 设置分区：提案审阅 | ok |
| 188 | `p5-set-export` | 设置分区：导出 | ok |
| 189 | `p5-set-outline-import` | 设置分区：大纲转换 | ok |
| 190 | `p5-set-carrier:pinax.carrier.novel` | 设置分区：写作偏好 | ok |
| 191 | `p5-settings-search` | 设置搜索「字号」 | ok |
| 192 | `p5-settings-search-none` | 设置搜索无命中（zzzz） | ok |
| 193 | `p5-settings-close` | Esc 关设置 | ok |
| 194 | `p6-tab-rail-overlap` | 专章取证：5 扇收起态并存（页签栏角标＋右缘竖排缘签） | ok |
| 195 | `p6-tab-rail-zoom` | 专章取证：右缘竖排缘签特写（压字可读性实证） | ok |
| 196 | `p7-back-to-novel` | 把正文页重新置为当前页（页签栏点「正文」） | ok |
| 197 | `p7-chapter-edit` | 按正文头那枚「编辑」（data-test="chapter-edit"）进编辑态 | ok |
| 198 | `p7-band-focus` | 点进正文编辑器（动作带按设计应在聚焦后浮现） | ok |
| 199 | `p7-band-noselection` | 无选区：动作带只剩「续写」 | ok |
| 200 | `p7-band-selection` | 选中一句：五档动作全出（改写/扩写/压缩/润色跟着选区走） | ok |
| 201 | `p7-band-zoom` | 写作动作带特写（五档按钮的实测命中区） | ok |
| 202 | `p7-cancel-edit` | 按「取消」退回阅读态（动作带随之收起） | ok |
| 203 | `p8-wb-open` | 世界书：点图标条进板（看此刻停在哪一态） | ok |
| 204 | `p8-wb-back-to-list` | 世界书：回落到清单态（口径基线） | ok |
| 205 | `p8-wb-table-again` | 世界书：点一次切换 → 表格态（复现 capture3 的 17 行） | ok |
| 206 | `p8-wb-graph-real` | 世界书：再点一次 → 关系图态（capture3 从未拍到的一格） | ok |
| 207 | `p8-wb-graph-hover` | 关系图：悬停首个节点（有无高亮／提示） | ok |
| 208 | `p9-wb-entry-edit` | 世界书：条目进编辑态（找「关系」区的第一层） | ok |
| 209 | `p9-wb-meta-relations` | 世界书：元信息展开 → 「关系」录入面实拍 | ok |
| 210 | `p9-wb-cancel-no-save` | 世界书：取消编辑（未落盘，关系面只看不写） | ok |

> 完整读数（状态栏、窗态、页签、命中区、失败原因）见 `_tools/walk-manifest.json`；缘签重叠的逐条实测见 `_tools/tab-rail-evidence.json`；服务版报告把两者并进了同一张表。
