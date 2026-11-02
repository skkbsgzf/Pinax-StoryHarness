# 批次61 工单：中心区「页底座」——切换为缺省落点，浮窗降级为显式动作（2026-11-01）

> 调度方：Zcode。执行方：Qoder CLI。
> 依据：`docs/plan/pinax-next-open-target-research-20261101.md`（§0 四条判据／§3 十二家一手对照／§5.3 缺省落点决策表／§7 待裁七问），作者已阅。
> 作者本次裁定（两句原话，全文有效）：
> ①「每当我想打开一个新的插件页的时候，它默认都是先给我弹出一个悬浮窗，这个完全就不是用户的逻辑……首先考虑的是**切换**，其次考虑的是**分屏**，然后用户指定的情况下，再去考虑卡片和悬浮窗。」
> ②「先把中心区域的仿浏览器／IDE 的**底座**拧出来，然后再让**页面往里填**不就行了。」
> ③（2026-11-01 追加，工单一稿出来后裁的）「**形态切换可以多用右键，不必做成死按钮**。」
> ④（2026-11-01 追加，沙盘给完、作者问「你不改 electron 么，那怎么体现 doc 引擎的变化」之后裁的）实施范围选「**底座＋D 一轮做完**」。这一刀因此**不再分两轮**：中心区的页底座（任务 1–8）与「每页一份文档」（原 §7 第 2 问的 D）同一轮落地——页身份吃 resource、每页各持自己的文档与草稿。下面铁律五／六、任务 1／2／3／8、「允许文件」与「禁止边界」里凡是写着「本批忽略 resource／不许动 selection／那是 D 另一刀」的，**按裁定④作废**，作废处逐条标〔④〕。
> **本批＝底座。它显式覆盖批次59 铁律二**（原文「打开文档＝开浮窗，默认不占页」）**与铁律五的一半**（原文「竖条右键『打开方式』入口零残留」——`ActivityRail.vue:62` 那次只删 emit 的清理，本批以右键形态菜单把它接回来）；共存能力（分屏／浮窗／收起）一条不删，只是从缺省降为显式、从按钮改为右键。

## 设计铁律（六条，实现与测试对着验）

1. **页是一等对象**。中心区的状态轴＝页组（`group: 'main' | 'side'`）× 页列表（`order`）× 每组当前页（`active`）× 形态（`form: 'page' | 'floating' | 'tab'`）。`side` 是**页组**不是形态——它承接今日的分屏；`floating` 是唯一持有几何的形态。
2. **缺省＝切换**。任何裸激活——竖条格、左树行、看板卡、蓝链、检索命中、图谱节点——只允许「揭示已有页」或「换当前页」，**绝不新建浮窗**；同一资源已开就回到那一页（老前端 `src/stores/workspaceTabsStore.js:119-144 openOrFocus` 的语义）。
3. **升档只走显式动作，显式动作＝右键菜单，本批不新增任何常驻形态钮**（作者裁定③）。页签与窗头右键各出同一份「形态」菜单——占页／分屏（搬进 side 组）／浮出为窗／收成侧缘标签／关闭；`PaneWindow` 右上角既有三钮（collapse／split／×）外观与 `data-window-action` 标记一律不动，那是批次59 铁律一已批的 chrome，本批只改点击后果。**菜单项不许凭空长出来**：只从这块 pane 清单声明的 `forms` 里出，经 `next/shell/paneForms.mjs:sanitizePaneForms` 过滤（P18「未声明的形态不出现在右键菜单」在批次59 断了消费端，本批重新接上）。**本批不做修饰键、不做中键、不做拖出**——手势管线整包留批次62（研究文档 §7 第 6 问）。
4. **页签栏不是第二套窗口壳**。它只回答「哪一页是当前页」，DOM 里不许出现拖拽句柄、缩放角、标题栏；窗口动作一律回 `PaneWindow`。右键弹出的形态菜单是**浮层**，不是 chrome：它无句柄、点外或 Esc 即收、坐标按视口钳住，样式与通路照现成的 `IndexWindow.vue:1188-1236`（`.nx-context-menu`／`.nx-context-item`／`.nx-context-group`，样式在 `styles/next-shell.css:1111-1160`），**不另起一套菜单**。visual-contract `next/tests/visual-contract.test.mjs:443`「PaneWindow 是唯一窗口壳」必须仍然通过，并新增一条反向断言钉住本条。
5. **页身份算法只有一处**：`pageIdOf(paneId, resource, pages)`。〔裁定④作废原文的「本批忽略 resource、返回 `<paneId>#1`」〕本批它**真吃 resource**：`keyed` 的 pane 同一块开两份不同文档＝两页（`#1`／`#2`），不是换掉当前页内容。resource 进工作区记录，且**被真消费**——重启时据此把每页恢复到它自己那份文档，并把该页的草稿／载入态接回。仍守「**不给工作区记录新增任何未消费字段**」。
6. **@4 的 `multiplicity` 本批全量真消费**（〔裁定④作废原文的「只吃一半／半个消费」〕）：`keyed`＝按清单 `keyField` 每份文档一页（全仓现值只有 `worldbook.entries`，`keyField:'path'`，`carriers/worldbook/manifest.mjs:47`）；`single`＝硬闸，该 pane 永不出现第二页，开另一份文档＝换当前页（**注意这比现状更严**：今日 `openInstance` 根本不读声明，`:2377` 那条「multiplicity 仍管开窗数量」是名不副实，本批必须改名并如实反映）；`list`＝会话级覆层小部件，仍一页。⚠ 由此暴露一条本批不能自裁的口径：12 份清单里**装文档的中心 pane 全声明 `single`**（正文／构思／资料／大纲／剧本／素材／漫画／体验／联机…），所以按声明老实办事，正文**开不了两章并排**；要它开得了，得把这些 pane 改 `keyed`＋给 `keyField`——那是声明层的产品语义变化，登记为 §7 待裁 ⑥，执行方不许自己改。`claims/priority/canOpen/takes` 本批不动。

## 任务

1. **`next/shell/workspace.mjs`：v2 → v3 状态轴**。`WORKSPACE_VERSION = 3`；记录由 `{geometry, z, minimized:'none|tab', maximized, tiledWith, tileSide}` 改为 `{instance, pane, group:'main'|'side', order, form:'page'|'floating'|'tab', geometry|null, z}`——**`maximized` 与 `tiledWith` 退役**：页态天然铺满所在页组，分屏由「side 组是否存在」表达（原来那对 `tiledWith` 互指只能装两个窗，是页组的退化形态）。工作区新增 `active: { main, side }`。浮窗态保留子态 `maximized`（双击标题栏占满中栏）——如实说这是对退役的一次例外，只在 `form==='floating'` 上有意义。
2. **读侧迁移 `migrateV2Entry`**：`maximized`（页态等价）→ `form:'page', group:'main'`；`tiledWith/tileSide` → 左半留 `main`、右半进 `side`；`minimized:'tab'` → `form:'tab'`；其余几何与 z 原样带入且 `form:'floating'`。真实靶子＝`D:\Projects\大梦\.pinax\workspace.json`（现值 5 条：`novel.editor#1` z=3 MAX、`outline.editor#1` z=4、`notes.editor#1` z=5、`worldbook.entries#1` z=6、`dossier.editor#1` z=8，后四条是级联浮窗）——迁移后应得 1 页占页＋4 页浮窗，**且这四扇浮窗出现在页签栏里**（这正是本批要给的"看得见"）。v1 那条迁移链保留不删。
3. **`next/shell/openTarget.mjs`（新，纯函数）**：`resolveOpenTarget({ pane, multiplicity, gesture, pages, groups }) → { action: 'reveal' | 'open-page' | 'raise-tab' | 'block', instance, group }`。唯一口径＝研究文档 §5.3：裸激活先揭示（同 pane 已有页 → 置其组当前＋bringToFront／展开标签）；无页则 `open-page` 进当前焦点组；`single` 命中已有页时永不新建。`gesture` 本批恒为空对象——留这个形参是为了批次62 不再改函数签名，注释里写清。
4. **`AppNext.vue`：内核替换，调用点不动**。`showBoardWindow`（:744-760）内部把「`shouldMaximize = maximize ?? !anyOpenWindow()`＋`nextFloatingGeometry()` 级联」换成 `resolveOpenTarget`；:779/:868/:915/:1023/:1125/:1130/:1505 七个调用点**一行不改**；`toggleBoardOverlay`（:843）保留浮窗（overlay 类 pane 的语义本就是"覆上来"，不属于本批收口对象）；分屏兜底那两行（:825/:831 `openInstance`）改走 side 组。附带把三条旁路归一：`openKnowledge`（:771）、`CarrierPaneHost.vue:770 openKnowledgeHit`、`EntryDetailPanel.vue:85/:99` 的条目跳转，统一"换当前页内容／揭示页"，消掉研究文档 §2 第 2／3 条「同一根蓝链两种结果」。
5. **`next/shell/PaneTabStrip.vue`（新）＋形态菜单**：列 `list()` 里全部页记录（跨 main／side／floating／tab 四态，`data-page-instance` 与 `aria-selected` 齐；浮窗与侧缘标签也要有签，否则「看得见」这件事只覆盖一半），点＝揭示，×＝关页，**签上不放任何形态钮**；中键本批不做（批次62）。右键（页签与窗头同一条通路）开「形态」菜单，项＝下表命中之类，动作一律作用在**被右键那一条记录**上（同 `docs/plan/pinax-context-menus-20261015.md` §5「右键给当前对象的高频操作、菜单短、危险项在末尾」）：

   | 清单 `forms` 词 | v3 落点 | 菜单文案 | 本批能不能做 |
   |---|---|---|---|
   | `dock` | `form:'page'`，留在当前页组 | 占为页 | 能 |
   | `split` | `form:'page'` ＋ `group` 换到对面组 | 移到侧页组（对半） | 能 |
   | `overlay` | `form:'floating'`（首次给级联几何） | 浮出为窗 | 能 |
   | —（清单无词） | `form:'tab'` | 收成侧缘标签 | 能（v3 自有态，不借词表） |
   | `fullscreen`／`immersive` | v3 无独立落点：`workspace.mjs:146-147` 早已把它们收成「最大化」 | **本批不进菜单** | 不能——进了就是骗人的入口；见 §7 待裁 ④ |

   样式进 `styles/next-shell.css`，复用 `control-quiet` 与既有 token；**不许 import 老前端标签组件**——老前端 tab 样式在组件 scoped 里、不在 `styles/legacy.mjs:18-22` 那五个文件内，本批只抄词汇与度量。
6. **`PaneWindow.vue` 接 v3**：props 从 `minimized/maximized/tileSide` 三轴改 `form`＋`group`＋（浮窗态下）`maximized`；`state` 计算与 `cardStyle` 按新轴重写；右上角三钮（collapse/split/×）外观与 `data-window-action` 标记**保持不变**，只改点击后果——页态点 split＝搬进 side 组。标题栏加 `@contextmenu.prevent.stop`，开的是任务 5 那份同一菜单（窗头与页签两个入口，一套实现、一份口径）。
7. **`paneForms.mjs` 重新上岗**：文件头「批次59 起只作兼容读／新代码不要再 import 这里的词表来驱动界面」（`next/shell/paneForms.mjs:2-7`）随本批作废，改成「形态入口的词表与文案单一来源，右键菜单据此列项」；`sanitizePaneForms`／`PANE_FORM_LABELS` 由菜单消费，12 份清单的 `forms` 声明一字不改（声明本来就是活的，死的是消费端）。
8. **断言与门禁**：`shell-ui.spec.mjs` 五条钉旧缺省的用例改期望并逐条写理由（`:2745`「第一扇占页、后续浮窗」→「裸激活一律揭示或换页，零新建浮窗」；`:2586`「多扇窗共存」→ 保留但期望改为「共存经页签栏可见」；`:2253` 切板共存语义不变；`:2678` 收起标签堆不变；`:2377` 那条名字必须改名）。**因裁定③必须翻的两条**：`:2517`「竖条右键不再有『打开方式』菜单（铁律一／五）」与 `:2541`「未声明 forms 的载体：右键仍无菜单」——前者改成「窗头／页签右键出形态菜单，且项只出自 `forms` 声明」，后者保留其真命题（未声明＝不伪造形态）但改测「右键菜单为空即不弹」；两条都要在注释里写明是 2026-11-01 作者裁定③，不许静默放宽。新增：迁移用例（拿大梦那 5 条真记录跑 `migrateV2Entry`）、`single` 硬闸用例、"页签栏不含拖拽/缩放句柄与常驻形态钮"反向断言、"裸激活零浮窗"零命中断言、"菜单项＝`forms` 声明 ∩ 词表"用例。

## 允许文件

`next/shell/workspace.mjs`（v3＋迁移）、`next/shell/openTarget.mjs`（新）、`next/shell/PaneTabStrip.vue`（新）、`next/shell/PaneFormMenu.vue`（新，形态菜单；若实现上更省事，也可以并进 `PaneTabStrip.vue` 但必须给 `AppNext`／`PaneWindow` 复用同一份）、`next/shell/paneForms.mjs`（只改文件头口径＋被菜单 import）、`next/shell/AppNext.vue`、`next/shell/PaneWindow.vue`、`next/shell/CarrierPaneHost.vue`（仅蓝链归一那几行）、`next/shell/EntryDetailPanel.vue`（同上）、`next/shell/useBoardData.mjs`（**只允许加 `pageIdOf` 的调用面，不许动 `state.selection` 那一格**）〔裁定④作废：本批要把它**按页实例化**——`AppNext.vue:70` 现在全应用只 new 一份 `useBoardData` 并经 `:data` 下发（`:1450` 索引窗／`:1504` 画廊／`:1550` 每扇窗），所以两块同 pane 必然显示同一份稿子。改法＝按页实例各持一份 boardData（索引窗／画廊／Agent 栏仍用基座那份），跳转写入目标页实例；工厂形状不动（`useBoardData.mjs:26-27` 本就是函数内 `reactive`）〕、`next/workspaceStore.mjs`（序列化版本判）、`next/shell/styles/next-shell.css`、`next/tests/**`（含 `visual-contract.test.mjs`＋计数白名单，改动写理由）、`next/testing/acceptance.mjs`、`docs/plan/` 本工单 §7＋批次记录。**条件允许**：`next/shell/ActivityRail.vue` 只在 §7 待裁 ⑤ 点头后才动。

## 禁止边界

不动协议 schema（@4 一字不改）；不动 12 份载体清单（`multiplicity` 的 single→keyed 属声明语义变化，未经 §7 ⑥ 点头不许改）；~~不动 `useBoardData` 的单一数据源与全局 `selection`~~〔裁定④作废：本批就动这刀，按页实例化〕；不动批次43 自动保存与批次39 事件刷新基线（**但这两处必须扇出到全部页实例**：每页各存各的脏稿，事件刷新要逐页判定，不许只刷基座那份）；**不做修饰键／中键／拖出／快速切换器**（批次62 与 §7 第 7 问）；右键菜单本批做，但**只装形态这一组动作**，不往里塞内容操作（内容菜单仍归索引窗自己那两份）；不动右 Agent 栏与编辑面本体；不改 `src/**`、`server/**`；不加 npm 依赖；不起 Electron、不执行 git；**不许新增任何无人消费的状态字段或清单声明**（同理，也不许在菜单里放一个状态轴装不下的形态项）。

## 守卫标记

批次45–60 全清单继承；本批新守卫：`WORKSPACE_VERSION === 3`、`openTarget.mjs` 存在且是纯函数（无 DOM 无 IPC）、`PaneTabStrip.vue` 存在且不含 `nx-pane-window-resize`／`pointerdown` 拖拽句柄、**页签 DOM 里没有任何形态钮**（形态入口只在 `contextmenu` 通路上）、**形态菜单复用 `.nx-context-menu` 词汇且不新写一套弹层样式**、菜单项集合＝`sanitizePaneForms(pane.forms)` ∩ 本批可落点（`fullscreen`／`immersive` 不出现）、`showBoardWindow` 体内不再出现 `nextFloatingGeometry()` 作为缺省分支、七调用点 grep 计数不变。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；基线现值＝acceptance 35/35、node 648、vitest 199（14 文件）、lint 0 警告、bundleAssertions 全过，**计数上移要写理由，断言漂移要改断言**；新增用例各有 `file:line`；真窗口实拍五张（页签栏列出多页／裸点蓝链只换页不弹窗／页签右键菜单展开且项只出自 `forms` 声明／经菜单「浮出为窗」→再经菜单「占为页」／重启后大梦那 5 条迁移结果）由调度方接管采集；六条铁律逐条有测试或反向断言对应。

## 记账指标（不进闸，只进复核清单）

裸激活产生新容器的次数（目标 0，但不设隐形阈值）；同 pane 双开同一文档的次数（本批按设计仍为 0，因 `pageIdOf` 恒返回 `#1`——这条是给 D 看的基线）；`multiplicity` 三态各自消费点数（`single`＝1，`keyed`／`list`＝0，如实记）；页签栏在窄屏（批次9 那一轨）是否挤爆——挤爆就进 §7 第 4 问的收口议题，不在本批擅自加 LRU。

---

## §7 待作者点名（工单里先记账，执行方不得自裁）

① ~~页签上那枚「浮出」钮~~ —— **已裁（追加裁定③）**：不做死按钮，形态切换走右键。铁律三／四、任务 5／6／7、守卫标记与验收判据已按此重写；批次59 铁律五「竖条右键零菜单」被本批翻掉的那一半，在两条断言（`shell-ui.spec.mjs:2517`／`:2541`）的改写注释里留名。
② **overlay 类 pane（`toggleBoardOverlay`）继续默认浮**：它是协议里的 `overlay` 槽，与稿件页不同物种，本批不收口。
③ `keyed`／`list` 按 `single` 处理＝"半个消费"的过渡态留多久——若你不打算近期做 D，就要在清单文档里把这两个取值显式登记为未采用（与 `chain` 同处理，`carrierManifest.paneSemantics.mjs:20` 有先例），不能长期挂着一个名不副实的声明。
④ **`fullscreen`／`immersive` 这两个词怎么办**：v3 状态轴里没有它们的独立落点（`workspace.mjs:146-147` 早就把它们收成「最大化」了）。本单主张右键菜单**不列**这两项（列了就是看着能点、其实没差别），但 12 份清单仍在声明它们——要么批次62 给「全屏」一个真落点（当前页组铺满＋隐左右栏），要么照 `chain` 的先例登记为未采用。请你择一。
⑤ **竖条格右键要不要一起恢复**（P19 的原入口：窗还没开就先选形态）：本批的菜单挂在「已存在的页」上（页签＋窗头），竖条右键仍维持批次59 的零菜单状态（`ActivityRail.vue:62` 的 `@contextmenu.prevent` 不动）。要一起恢复就得动 `ActivityRail.vue`，它已列入允许文件的「条件允许」档，等你点头。
⑥ **〔裁定④实施中新暴露，2026-11-01，执行方不得自裁〕装文档的中心 pane 要不要从 `single` 改 `keyed`**：按 @4 现有声明，全仓只有 `worldbook.entries` 是 `keyed`（`keyField:'path'`），**其余中心 pane 一律 `single`**——正文、构思编辑、资料与约束、大纲编辑、剧本、素材、漫画、体验、联机都是。铁律六既然要「`multiplicity` 真消费」，老实办事的结果就是**正文开不了两章并排**（点第 13 章会把第 12 章那页换掉），D 只在世界书这一格看得见。要两章并排得把这些 pane 改 `keyed` 并各给 `keyField`（文档身份字段：文件路径／记录 id），代价是①动 12 份清单里的一批声明（协议 schema 不动，动的是声明取值），②`bundleAssertions.mjs:424` 的 `keyedPanes === 1` 要跟着抬，③「同一稿子重复开」从此需要一个去重键。**这是产品语义变化，不是本批能顺手做的**；本批按声明办事，把这一格如实记在这里。

## §8 执行方回填 ／ 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch61-20261101.md`；§8 调度方补；差异指引用临时索引法，不新增只镜像实现的测试。）
