# 批次61 记录：中心区「页底座」——切页为缺省，浮窗降为显式动作（2026-11-01）

> 工单：`docs/plan/pinax-electron-next-m2-batch61-ticket-20261101.md`（作者裁定①缺省＝切换／②先拧底座／③形态走右键不做死按钮／④底座＋D 一轮做完）。
> 执行方：Qoder CLI。前置：批次59（窗口系统＋布局模板）、批次60（载体形体重排）已收口。
> 结果：`npm run verify:next` 五段全绿（`EXIT=0`）；本批**显式覆盖批次59 铁律二**（「打开文档＝开浮窗」）与铁律五的一半（竖条右键零菜单），共存能力一条不删，只从缺省降为显式、从按钮改为右键。
> 真窗口实拍五张与 §8 由调度方接管。

---

## 1. 八块任务 → 落点

| 任务 | 落点 | 对应测试 |
|---|---|---|
| 1 workspace v2→v3 状态轴 | `next/shell/workspace.mjs:30` `WORKSPACE_VERSION = 3`；记录形状改 `{instance, pane, group, order, form, resource, geometry\|null, z, maximized}`；`maximized` 只作浮窗子态；`DEFAULT_FLOATING_GEOMETRY`（`:50`）、`FORM_RANK`（`:306`，页<浮<签 的稳定序）；工作区新增 `active:{main,side}`＋`focus` | `workspace.test.mjs`「v1→v3 迁移…」「往返：v3 落盘再读回不变形（含每页文档、页组、形态与当前页）」「当前页指针是脏的→读入即修」 |
| 2 读侧迁移 `migrateV2Entry` | `workspace.mjs:191`：`minimized:'tab'`→`form:'tab'`、`maximized`→`form:'page'`、`tiledWith`→`form:'page'` 且 `tileSide:'right'`→`group:'side'`、其余→`form:'floating'` 带几何；警告 `WORKSPACE_MIGRATED_V2`；落盘只认 `{version,entries,active,focus}` 四格 | `workspace.test.mjs`「v2→v3 迁移：tab→侧缘标签、maximized→页、贴靠→页组、其余→浮窗，resource 一律待重开」；界面侧 `shell-ui.spec.mjs:2610`「version:2 存档在 UI 层一次迁移到 v3」 |
| 3 `openTarget.mjs` 唯一决策口径（新，纯函数） | `next/shell/openTarget.mjs`：`resolveOpenTarget({pane,multiplicity,resource,pages,groups,gesture})` → `reveal\|replace-page\|open-page\|raise-tab\|block`；**五档里没有任何一档新建浮窗**；`pageIdOf(:36)` 真吃 resource；`gesture` 非空即 `block/GESTURE_NOT_IMPLEMENTED`（批次62 解除） | `open-target.test.mjs` 9 例（纯函数，无 DOM 无 IPC）；界面侧 `shell-ui.spec.mjs:2548`「multiplicity=single 硬闸」、`:2243`「点竖条＝切出一页」 |
| 4 `AppNext.vue` 内核替换＋三旁路归一 | `routeOpen(:932)` 为唯一开窗通路；`showBoardWindow(:965)` 体内不再有 `nextFloatingGeometry()` 缺省分支（全文件该函数名零命中；调用点保持原形状——现 5 处：`:1304/:1423/:1537/:1542/:1928`，原「蓝链自己再 `showBoardWindow` 一次」那一条随旁路归一退场，`:1149` 注释留名）；分屏走 `applyFormAction(:1217)`→`moveToGroup`；`toggleBoardOverlay(:1240)` 仍默认浮（〔§7 待裁②〕overlay 是另一物种）；蓝链三旁路收口：`CarrierPaneHost.vue:786 openKnowledgeHit`、`EntryDetailPanel.vue:83 openTarget`／`:101 openBacklink` 一律交回宿主 `openKnowledge` | `shell-ui.spec.mjs` 批次61 段全部 13 例；`index-book-tools.spec.mjs`／`carrier-pane.spec.mjs` 的蓝链用例继续通过 |
| 5 页签栏＋右键形态菜单（新，签上不放死按钮） | `next/shell/PaneTabStrip.vue`（`data-test="page-tabstrip"`、`data-page-instance`、`aria-selected`；整条只有一枚 `<button>`＝×）；`next/shell/PaneFormMenu.vue` 复用 `.nx-context-menu`／`.nx-context-item` 词汇，不新写弹层样式；菜单项＝`sanitizePaneForms(pane.forms)` ∩ 本批能落点，`fullscreen`／`immersive` 不列 | `visual-contract.test.mjs:788-793`（页签只一枚钮、不放 `data-window-action`）；`shell-ui.spec.mjs:2314`「形态只从右键菜单改…」（项序与置灰、未声明不伪造） |
| 6 `PaneWindow.vue` 接 v3 | props 由 `minimized/maximized/tileSide` 改 `form`＋`group`；`state`／`cardStyle` 按新轴重写；右上三钮外观与 `data-window-action` 不动，只改后果（页态点分屏＝搬进 side 组）；标题栏 `@contextmenu` 与页签右键同一份菜单 | `visual-contract.test.mjs:779-784`（必须有 `data-window-group`／`is-in-side`，且 `minimized`／`tiledWith`／`tileSide` 零命中）；`shell-ui.spec.mjs:2359`「分屏＝把这一页搬进对面页组」 |
| 7 `paneForms.mjs` 重新上岗 | 文件头口径由「只作兼容读」改为「形态入口的词表与文案单一来源」；`FORM_ACTIONS`／`MENU_TARGET_FORM`／`PAGE_ACTIONS` 被菜单消费；12 份清单的 `forms` 声明一字未改 | `pane-forms.test.mjs` 6 例；`form-taxonomy.test.mjs` 继续通过 |
| 8 D：每页一份文档（裁定④） | `AppNext.vue:132 pageDataMap = new Map()`＋`:137 pageDataOf(instance)`＋`:1372 ensurePaneData`（按这一页自己的 `loadedTrees` 判取数）；索引窗／画廊／Agent 栏仍用基座那份；`useBoardData.mjs` 工厂形状不动（本就函数内 `reactive`）；批次43 自动保存与批次39 事件刷新扇出到全部页实例 | `shell-ui.spec.mjs:2576`「multiplicity=keyed：一份文档一页，两页各看各的稿子」、`:2652`「空白卡修复（v3）」；`records-data.spec.mjs`／`carrier-pane.spec.mjs` 未改期望仍全过 |

## 2. 中心区怎么画（三层，写死在宿主）

`pageTierWindows`（`AppNext.vue:1039`）＝`[activePageWindow('main'), activePageWindow('side')]`：**每个页组只画当前那一页**，其余页只活在页签栏；`floatWindows`＝`form:'floating'` 按 `z` 升序；`sideTabWindows`＝`form:'tab'` 堆在缘侧。所以「两张页对半」不是分屏形态，而是 main／side 两组各有当前页——旧 v2 那对 `tiledWith` 互指（只能装两个窗）随之退役。

## 3. 断言即规格：旧 18 条 → 新 13 条逐条对账

批次59 的两节窗口用例（旧 `shell-ui.spec.mjs:2105-2888`，18 例）整体重写为批次61 段（现 `:2119-2741`，13 例）。**这是重写，不是放宽**：每条旧断言的去向如下，两条翻案与一条作废都在用例注释里留名。

| 旧用例（行为） | 处置 | 新落点 |
|---|---|---|
| 第一扇占页、后续浮窗（铁律二） | **翻案**（裁定①推翻） | 「点竖条＝切出一页：form 落 page、进主组、不带几何，一条浮窗都不开」 |
| 未声明 forms 的载体：右键仍无菜单（不伪造形态） | 保留真命题，降为一段 | 「形态只从右键菜单改」末段（`:2467` 起：没声明 forms 的载体点竖条只切页，菜单不凭空长项） |
| 统一 chrome：三枚钮＋竖条右键不再有「打开方式」（铁律一／五） | **翻案**（裁定③）＋chrome 保留 | 「统一 chrome：三枚钮＋没有第二套窗口壳；竖条右键不弹形态菜单」＋「形态只从右键菜单改」 |
| 中间 doc 区是窗口管理器：多扇窗共存，点窗抬叠序，窗态不变 | 改语义 | 「切板不碰别的页；点页签＝揭示那一页（不新建、不升档）」（浮窗共存另见右键用例的 `bringToFront` 段） |
| 浮窗可拖可缩放：标题栏与四角写回 v2 矩形 | 改名（v3 只有浮窗持矩形） | 「只有浮窗持有矩形：拖动／缩放写回工作区，重新挂载读回同一坐标（收起与占为页都清成 null）」 |
| 位置记忆：拖动写进存档 `outline.widget#1`，重挂读回同坐标 | 并入同一例 | 同上（跨挂载段） |
| 最大化＝铺满中间区：双击切换，浮窗几何保留，再双击回浮窗 | 并入同一例；**这一并抓出真缺陷**（见 §4） | 同上（maximized 子态四段） |
| 收起成侧缘标签…（**旧断言「收起不啃 geometry」翻案**） | 翻案：v3 里只有浮窗持有矩形，收起／占为页一律写 `geometry: null` | 「只有浮窗持有矩形」末段＋「侧缘标签」 |
| 开/收/关：索引窗「悬浮」钮开小窗；右上三钮＝收起／分屏／×；Esc 与收起同义 | 拆 | chrome 归「统一 chrome」，收／展开归「侧缘标签」，Esc 归「Esc＝把最上面那一页收成侧缘标签」 |
| 切板：上一载体的窗保持原位（多载体共存） | 改期望（页底座下＝不动别的页） | 「切板不碰别的页；点页签＝揭示那一页」 |
| Esc 优先关统一二级页：设置开着时 Esc 收起的是弹窗，窗口不动 | 保留 | 「Esc＝把最上面那一页收成侧缘标签；统一二级页开着时 Esc 先归弹窗」 |
| 收起＝侧缘标签堆：多扇收起依次排开，点一枚只还原那一扇 | 降为一段 | 「侧缘标签」例中「缘签按叠序依次下移，多扇收起不叠成一枚」 |
| 同一 pane 多开（multiplicity 仍管开窗数量）：第二份是 `#2`，几何各记各的 | **改名**（工单任务 8 指名：旧名名不副实）＋一拆为二 | 「multiplicity=single 硬闸：换文档＝换这一页装哪份稿子，不另起一页」＋「multiplicity=keyed：一份文档一页，两页各看各的稿子」 |
| 分屏＝对半贴：点右上分屏钮，当前窗与另一扇各占一半；再点解除回浮窗 | 改语义（分屏不是窗态） | 「分屏＝把这一页搬进对面页组（不是第四种形态）：两组各占一半，再点搬回来」 |
| 关窗：× 删记录；分屏搭档同时解除贴靠，另一扇仍开着 | 前半保留，后半随贴靠退役消失 | 「侧缘标签：…× 删记录（页签栏同时少一条）」 |
| 贴靠不留半对：分屏中最大化其中一扇＝两扇一起解除贴靠 | **作废**（v3 无 `tiledWith`：分屏＝页搬进对面组，最大化只剩浮窗子态，「半对」这个概念在状态轴里没有落点，留着就是给一个不存在的不变量写断言） | 无替代——如实记为被推翻的行为 |
| 空白卡修复：没访问过大纲板，小窗挂载即触发 `loadOutline` | 保留（改 v3 夹具） | 「空白卡修复（v3）：存档里开着的浮窗，挂载即补一次取数，窗口不摊空树」 |
| 停用载体＝解注册：清该载体全部 pane 实例的 placement/geometry/pinned | 保留（轴名改 v3） | 「停用载体＝解注册：该载体全部页记录清出工作区（v3 轴），别的载体原样」 |
| —（新增，工单任务 5／8 要求） | 新增 | 「形态只从右键菜单改」（含 `fullscreen`／`immersive` 不进菜单）、「version:2 存档在 UI 层一次迁移到 v3」、「multiplicity=keyed」 |

`shell-ui.spec.mjs` 由 88 例变 83 例（净 −5）：−5 全部来自上表的**合并**（未声明 forms／位置记忆／最大化／拖缩放／缘签堆五条独立用例降为别条用例里的段落）与**贴靠那条作废**；同时新增三条独立用例。行为覆盖面是增不是减。

## 4. 本批顺带修掉的两个真缺陷

1. **最大化浮窗卡死**（`next/shell/PaneWindow.vue:196 onTitleDblclick`）：判闸用的是 `state`（此刻是 `maximized`），于是双击一次之后既不能再双击还原、也拖不动（缩放／拖拽手柄只在 `floating` 渲染），那扇窗从此钉死。改判 `props.form !== 'floating'`——`maximized` 是浮窗的子态，用 `state` 判等于把「再双击还原」这条路自己堵死。是重写「最大化＝铺满中间区」那条旧断言时暴露的，不是先修再补测试。
2. **overlay 小窗的窗头右键只剩页操作**（`AppNext.vue` `overlayPanes` 描述符）：描述符没带 `forms`，窗头右键拿不到清单声明，等于 P18「菜单项只出自声明」在 overlay 这一格被消费端丢掉。补 `forms: Array.isArray(pane.forms) ? pane.forms : []`。

## 5. 守卫标记落点

| 工单守卫 | 落点 |
|---|---|
| `WORKSPACE_VERSION === 3` | `workspace.mjs:30`；`workspace.test.mjs` 断版本；`acceptance.mjs` 走落盘四格 |
| `openTarget.mjs` 是纯函数（无 DOM 无 IPC） | 文件只 import `workspace.mjs` 的 `instanceIdFor/parseInstanceId`；`open-target.test.mjs` 9 例直接喂数组 |
| 页签栏不含拖拽／缩放句柄，DOM 里没有形态钮 | `visual-contract.test.mjs:788-793`（`<button>` 计数＝1、`data-window-action` 零命中）＋`shell-ui.spec.mjs:2321`（页签上的钮只有 `close` 一枚） |
| 形态菜单复用 `.nx-context-menu` 词汇、不新写弹层 | `PaneFormMenu.vue` 只用既有类名；样式只在 `styles/next-shell.css` 的既有条目里 |
| 菜单项＝`sanitizePaneForms(forms)` ∩ 能落点 | `paneForms.mjs:MENU_TARGET_FORM`＋`shell-ui.spec.mjs:2314`（项序 `dock/side/float/tab/close`，无「全屏」「沉浸」，`dock` 在页态置灰） |
| `showBoardWindow` 体内不再出现 `nextFloatingGeometry()` 缺省分支 | `AppNext.vue:965-982`（全文零命中该函数名） |
| 「七调用点 grep 计数不变」——**这条守卫按字面不成立，如实登记** | 现 `showBoardWindow` 共 6 次命中：定义 `:965`＋调用 `:1304/:1423/:1537/:1542`＋模板 `:1928`，另 `:1149` 是说明注释。少掉的那一条正是任务 4 要求归一的「蓝链自己再开一次窗」旁路——守卫的字面计数与任务四互相冲突，本批按任务四办事并把差额记在这里。`routeOpen` 全站只有 5 处命中（定义＋四个入口），竖条／左树／看板卡／蓝链／检索命中／图谱节点／迷你大纲都收敛到 `routeOpen` 或 `openPaneByKind`；竖条右键仍零菜单（`ActivityRail.vue:62` 的 `@contextmenu.prevent` 未动，〔§7 待裁⑤〕） |
| 继承批次45–60 全清单 | `visual-contract`／`form-taxonomy`／`carrier-pane` 等原用例未删；`carrier-pane` 51 例全过（本段断言改写没有动它的期望；批次61 前段是否动过无法从 git 取证——快照只到批次41） |

## 6. 测试与门禁

`npm run verify:next`（2026-11-02 01:19，`EXIT=0`）：

| 段 | 结果 |
|---|---|
| `node next/testing/acceptance.mjs` | `M1 空框架＋M2 真载体验收：35/35 通过`（11/11 @4、44 把载体工具、聚合 40／载体服务 24 不变） |
| `node --test "next/tests/*.test.mjs"` | `tests 673 / pass 673 / fail 0`（批次60 基线 648 → +25） |
| `vitest run --config next/vitest.next.shell.config.mjs` | 14 文件 / 194 用例全过（shell-ui 83、carrier-pane 51；基线 199 → −5，逐条理由见 §3） |
| `npm run lint:next` | 零警告（`--max-warnings 0`，`EXIT=0`） |
| `node next/testing/bundleAssertions.mjs` | 全部通过：主进程 bundle 1818.5 kB、外壳 bundle 2108.0 kB、renderer js 1126.3 kB、CSS 173.2 kB、preload 5.3 kB |

node 段 +25 的来源是新文件 `open-target.test.mjs`（9 例）与 `workspace.test.mjs`（35 例，v3 轴／v1v2 迁移／往返／磁盘层）、`pane-forms.test.mjs`（6 例）与 `visual-contract.test.mjs` 的 v3 落点断言；未逐文件回溯批次59 的分布，故只报总量与新增文件清单，不报「恰好 +25 的构成」。删除的用例只有 §3 表里那 18 条（其中 17 条行为被合并/改名后继续存在，1 条随贴靠退役作废）。

分段验证记录：`shell-ui.spec.mjs` 单文件 83/83；`npx vitest run … -t "multiplicity=keyed"` 单例通过（用于排除跨用例污染，见 §7-4）。

## 7. 已知边界与偏差（limitations）

1. **真窗口实拍未做**：工单要求的五张（页签栏列多页／裸点蓝链只换页不弹窗／页签右键菜单展开／经菜单「浮出为窗」再「占为页」／大梦 5 条迁移结果）按工单由调度方接管；本批只在 jsdom 与产物层验证，未起 Electron、未执行 git。
2. **`fullscreen`／`immersive` 仍只在清单里声明、界面不消费**（〔§7 待裁④〕）：右键菜单不列这两项是工单主张，本批照做；要么批次62 给「全屏」一个真落点，要么照 `chain` 先例登记为未采用——等作者择一。
3. **正文开不了两章并排**（〔§7 待裁⑥〕）：12 份清单里装文档的中心 pane 除 `worldbook.entries` 外一律 `single`，本批按声明老实办事，`single` 硬闸＝换文档换当前页。要并排得改声明为 `keyed`＋给 `keyField`，那是产品语义变化，执行方未自裁。
4. **偶发 `MCP error -32000: Connection closed` 未处理**（本批不认领为新增缺陷，也未悄悄绕过）：全量 vitest 并行跑时，`carrier-pane-real.spec.mjs` 末尾偶发一条 Unhandled Rejection，栈为 `@modelcontextprotocol/sdk` → `next/runtime/transportInProcess.mjs:25` → `agentRuntime.mjs:211 stop()` → `index.mjs:209 close()`。机理已核到 SDK 源码：`Protocol._onclose()` 会给每个在途请求打回 `Connection closed`，而那条请求的调用方 promise 没人 await（外壳里一条 fire-and-forget 的 IPC 在会话关闭后才落地）。实测证据：并行全量 2 次红、之后 3 次全绿（含 01:19 那次完整门禁）；`--no-file-parallelism` 串行 1 次绿；单文件 1 次绿；「去掉 shell-ui 的 13 文件」「去掉 carrier-pane 的 13 文件」「carrier-pane-real＋shell-ui 两文件」各 1 次绿。**结论＝负载相关的竞态，不是本批断言改写的产物**（本批改动的三处——shell-ui 用例、`PaneWindow.vue` 双击判闸、`AppNext.vue` overlay 描述符——都不碰 runtime/MCP，且 shell-ui 全程用假桥，一个 MCP 请求也不会发出）。真正的产品级修法（外壳不许留未接住的 IPC promise，或运行时关闭前drain在途请求）超出本批范围，记账待裁。本批**没有**为此改任何断言、没加 `expect.unreachable`、没动 vitest 的 unhandled-rejection 报告口径。**〔闭合标记·批次69〕本条已被根治收口**：`transportInProcess` 关闭前 drain 在途请求、被硬关的拒绝转成失败信封并记账，`agentRuntime.callTool()` 不再向外抛，`index.mjs` 的 close 链统一走 `retireRuntime()` 并留退役报告；`--no-file-parallelism` 已从 `verify:next` 移除、并行全量连跑 3 次全绿。证据与欠账（面外 6 处 `watch(async …)` 台账、`ipcContract.dispatch()` 兜底）见 [批次69 记录](./pinax-electron-next-m2-batch69-20261102.md)。本条原文一字未改，历史照旧可读。
5. **`resource` 的写侧只到「界面真消费」，未到「全载体覆盖」**：`single` 的 pane 换文档时写 `resource`（如 `outline:node:1`），正文／条目／资料等仍由各自 `openXxx` 决定读哪份；`worldbook.entries` 的 `keyed` 语义在清单里已声明，本批用大纲编辑面夹具跑出两份文档两页的证据，真世界书并排仍挂 §7-3。
6. **页签栏在窄屏（批次9 那一轨）会不会挤爆未验证**：工单「记账指标」第 4 条要求只记账不加 LRU——本批未做窄屏页签溢出策略，窄屏实测留给调度方。
7. **手势（修饰键／中键／拖出）整包留批次62**：`resolveOpenTarget` 的 `gesture` 形参非空即返回 `block/GESTURE_NOT_IMPLEMENTED`，界面上没有任何入口往这里传值。

## §8 执行方回填 ／ 调度方验收

执行方回填见上（§1–§7）。待调度方补：真窗口实拍五张、§7 待裁 ④⑤⑥ 的裁定、偶发竞态的处置令（修产品／记欠账／还是等批次62 一起）、信用账。
