# 批次66 记录：状态轴收敛＋lastOpenFiles＋逐视图状态＋订阅词表扩展（Obsidian 框架轮·桩3）（2026-11-03）

> 执行：Qoder CLI。工单：[66](./pinax-electron-next-m2-batch66-ticket-20261102.md)。前置裁定 Q2（**删** `fullscreen`/`immersive`）已落。
> 全程未执行 git、未起/未杀 Electron；`npm run verify:next` 五段全绿（见「复现」）。

## 任务1 形态词表收敛（Q2 落地）

- **协议词表三值**：`paneForms.mjs` 的 `PANE_FORMS` 与 `carrierManifest.mjs` 的 `PANE_FORM_WORDS`、`host-descriptor.json` 的 `forms` 三处同删（`fullscreen`/`immersive` 不再出现在任何一份词表里，也**不进兼容读**——`sanitizePaneForms`／校验器一律按「不在词表」处置，不猜近义）。
- **随包清单删值**：`next/carriers/*/manifest.mjs` **11 份**（工单写「12 份」，实测口径见「与工单口径的差」）各删去这两个值，只动 `forms` 数组，其余字段一字未改。清理后 11 份一律声明 `dock / overlay / split`。
- **新守卫（进闸）**：`acceptance.mjs`〔批次66 任务1〕同时断言 ①词表恰是三值 ②每份清单声明的 `forms` ⊆ 词表且**至少声明一种**（防空转：删空了也算过）③零退役值命中 ④**词表与落点同构**——`Object.keys(FORM_ACTIONS)` 与 `PANE_FORMS` 逐项相等且每个词都带 `action`＋`label`。这条把批次61 limitation 2 的待裁闭合：菜单里从此不可能存在「点了没差别」的项。
- **v3 状态轴未动**：`PAGE_FORMS` 仍是 `page / floating / tab`，`MENU_TARGET_FORM` 未增删。窗口系统行为（批次59/61 语义）零改动。
- **老存档仍认**：`workspace.mjs` 的 v1 `placement` 与 v2 `form` 迁移分支里保留着 `fullscreen`/`immersive` 这两个**字符串比较**——那是读作者盘上那份旧 `.pinax/workspace.json`（把它们收成「最大化／浮窗」），不是协议入口。删掉它们等于把老存档的整条记录读丢。
- 顺带关闭台账 NOTE-1：`carrierManifest.mjs` 三处「宿主六种视图」陈旧文案（两处注释＋一处给作者看的 `RESERVED_VIEW_TYPE` 报错）改为不带数字的「宿主自带的视图」；**判定逻辑一字未动**，只测 code 的用例不受影响。

## 任务2 lastOpenFiles（打开文档记一笔，恢复＝预填不自动开）

- **状态机那一半**（`workspace.mjs`）：`LAST_OPEN_FILES_LIMIT = 20`；`pushRecentFile(files, {pane, resource})` 去重置顶、尾巴挤出、封顶 20；`normalizeLastOpenFiles` 读盘净化（坏条目逐条丢，不整份作废）。`lastOpenFiles` 进 `snapshot()`／`serialize()`／`load()`，落 `.pinax/workspace.json`（version 仍是 3，schema 未升）。
- **记在哪一笔**：`open()`（新开一页带 resource／把带 resource 的页带回前台／提到叠序顶）与 `setResource()`（同一页换装文档）**变更真实发生才记**——空点击不记，否则「最近打开」会被连点同一张页刷成噪音。`close()` **不调**这条：列表是「打开过什么」的历史，不是「现在开着什么」的镜像，所以关掉文档仍留在列表里。
- **入口（落点选择）**：**索引窗顶部**（`IndexWindow.vue` 的 `.nx-recent` 段，`data-test="recent-files"/"recent-toggle"/"recent-file"`），不在状态栏左键菜单。理由三条：①状态栏在批次63 有硬合同「四要素齐＋**可点件只有一枚**」（acceptance 里是断言），再加一枚可点件要动那条合同和 `StatusBar.vue`，两者都不在本批允许文件内；②「最近打开」是**导航**，和正文树同一个注意力区，作者找文档时眼睛本来在索引窗；③索引窗顶部是 folder 模板的常驻位，跨载体共用同一栏，不需要先切载体才看得见。
- **恢复语义＝预填不自动开**：`AppNext.vue` 把 `workspaceSnapshot.lastOpenFiles` 映射成可点行（`recentFiles` computed），点击走 `routeOpen({pane, resource})` 那条**唯一开窗通路**（已开着就回到那一页，没开就新开，`multiplicity` 判定不变）。启动时列表照摊，但**没有任何一页是为这两条记录而开的**。
- **标签怎么来的**：`recentLabel()` 现从各页已经取回的清单里找标题（`章 · 第001章-雨夜` 这种），找不到就退到路径末段去后缀——**不另存一份名字**（那是第二个真相来源），退路如实而不是编一个。

## 任务3 逐视图状态（folder 模板：卷折叠＋选中 resource）

- **折叠态**：`entry.viewState = { collapsed: [卷名] }`（`normalizeViewState`：字符串去重、封顶 200、**空集归 null** 所以全展开不写空壳；`setViewState` 是**整份替换**不是合并）。写口＝`IndexWindow.vue` 卷头那枚 disclosure 钮（`.nx-volume-toggle`，`aria-expanded` ＋ chevron 旋转），经宿主 `onIndexTreeState` 落到**这一页自己的**条目；读口＝`indexTreeState` computed，与页签高亮同用 `workspaceSnapshot` 那一行（登记表不是响应式的）。平铺那一组无卷名、不出钮。
- **选中 resource**：不新造字段——工作区早有 `entry.resource`（批次61〔D〕），本批修的是**它为什么留不住**：
  - 根因：重启取树时 `loadChapters({keep:true})`／`loadEntries()` 里那句「没有选中就替你开最后一章／第一条」会把存档那一份顶掉，随后 selection→resource 那条看门狗照着页上的选中标**反过来改写存档**，作者上次看的稿子就此丢失，并顺手污染 `lastOpenFiles`。
  - 修法：`preparePaneData(page, paneId, { autoOpen })`，**存档里带着自己的文档的那一页取树时关自动开门**（`autoOpen: !hostWorkspace.get(instance)?.resource`）；新增 `restorePageDocument()` 显式把存档那一份放回页上。找不回（改了名／删了）就**如实让页空着**——不替作者挑，也不动存档里那条 `resource`，等他自己点一行，看门狗照实更新。
- **其它视图登记不做**：滚动位置（工单原文「不进本批」）与 reader／outline／graph／board 等面的视图态一律未落。`normalizeViewState` 的形状**故意不扩**——没有消费方的键不落盘。
- 样式全进 `IndexWindow.vue` 的 `<style scoped>`（`next-shell.css` 不在允许清单）：一个新颜色都不加，hover 复用导航行那份 `--nav-hover`，折叠钮带 `prefers-reduced-motion` 退让。视觉合同守卫要求按钮进共享控件词汇，故三枚新钮都带 `nx-row`（不用 `control-quiet`——它的 legacy 规则 `0,4,0` 会压过 scoped 的 `0,2,0`，把 hover 底色吃掉）。

## 任务4 订阅词表扩展（F7：`file.changed` ＋ `layout.changed`）

- **词表扩到三词**：`CARRIER_SUBSCRIPTIONS = ['project.changed','file.changed','layout.changed']`（`host-descriptor.json` 的 `subscriptions` 同步）。@4 校验器据此放行，老清单只写 `project.changed` 照装。
- **总线两张表**（`eventBus.mjs`）：投递面 `PROJECT_EVENT_KINDS` 7 个 kind（新增 `file-changed`／`layout-changed`），声明面 3 个订阅词，中间唯一映射是 `PROJECT_EVENT_TOPICS`；反查 `projectEventKindsForTopic()`，**别处不许再抄一份映射**（测试也用它）。
- **负载形状定稿**：`{ kind, topic, at, path }` 四键**恒定在场**，取不到就是 `null`（前五类历史上不带 `path`，现在按 `null` 摊平，订阅方不必再判「这个键这次有没有」）。
- **两处真实发射点**：`fileService.notifyWrite` 发 `file-changed`（带 `relativePath`）；`workspaceStore` 落盘 rename 成功后发 `layout-changed`（带 `.pinax/workspace.json`）。**都只在事实发生时发**：写被闸拒（STALE／越权）不发，布局内容没变被跳过的那次不发，坏快照不发。写族闸／`expectedRevision`／返回值**一字未改**，事件是旁路（订阅者抛错不拦写盘）。
- **细／粗两条的先后**：同一次受控落盘先收 `file-changed`（哪份文件变了），随后收写入钩子按目录映射出的粗五类之一（哪块数据变了）——两个粒度各管各的刷新，不是重复投递。用例逐字断言这个顺序。
- **挑词投递语义**：`subscribeProjectEvents(root, handler, { subscriptions })` 只收所挑词覆盖的 kind，被过滤掉的**不计入送达数**；不传／非数组／**空数组**一律全收（批次37／39 那两条宿主订阅都没给，行为逐字不变）；**拼错的词什么都收不到**（不猜近义、不静默降级成全收）；认不出的自定义 kind → `topic:null` → 只投递给不挑词的订阅者。
- **`selection.changed` 登记不做**（工单原文）：壳层没有干净的选择发射点，页内选中态归各页数据面，硬造一个＝造第二个真相来源。
- **渲染层无回归**：`refreshTargetsFor('file-changed'|'layout-changed')` 返回空 → `AppNext.onProjectEvent` 提前 return，新事件不会误刷正文树。
- 合同与投递语义全文见 `docs/plan/pinax-electron-next-spec-v2-20261102.md` **附录 A**。

## 记账指标（工单要求，不进闸；`acceptance.mjs` 每次跑都打印）

- **记账①**（词表→落点→v3 形态轴）：`dock→dock(占为页)`、`split→side(移到侧页组（对半）)`、`overlay→float(浮出为窗)`；页形态轴 `page/floating/tab`（本批一字未动）。
- **记账②**（11 份清单 `forms` 清理对照）：`pinax.carrier.novel/outline/notes/worldbook/script/dossier/material/comic/video/experience/online` **全部 `[dock,overlay,split]`**，退役命中 0。
- **记账③**（`lastOpenFiles` 首版内容样例）：25 次推送（含 3 次重开）→ 唯一键 22 → 落盘封顶 20 条、首条＝最后一次那份、列表内零重复。样例前 3 条形如 `{"pane":"worldbook.board","resource":"entry:正文/第025章-样例.md"}`。**真实内容仍待真窗口实拍**（工单验收判据后半句由调度方接管），这里只证形状与封顶。
- 门禁读数：`acceptance` 44/44；`node --test` 727 通过 0 失败；shell vitest（`--no-file-parallelism`）201 通过；`lint:next` 零警告；`bundleAssertions` 全部通过（`v` 项今天报 `forms 3`，与收敛后的描述符一致，**未改任何计数**）。

## 与工单口径的差 ＋ limitations（做不到的都写在这里）

1. **「12 份清单」＝随包 11 份**。`next/carriers/*/manifest.mjs` 实测 11 块（批次53 起），acceptance 计数也是 11。删词面按这 11 份全清，无第 12 份可清。
2. **任务4 的「按订阅词送达已声明载体」只做成了总线能力，宿主那一行接线没动**。原因：逐载体的投递名单在 `next/runtime/mcpSurface.mjs:88-89`（`subscribedCarriers` 用 `.includes('project.changed')` 判）与 `next/runtime/agentRuntime.mjs:42/168`（`deliverProjectEvent`），**两者都不在允许文件内**；而 11 份清单本批只允许动 `forms` 数组，所以**没有任何一份清单声明了这两个新词**。落地的可观察事实是：新事件已沿批次39 那条链送到 `onProjectEvent`（用例覆盖，负载四键齐），而「挑词过滤」在总线一侧完备可用。要真按词精投，需要调度方补两行：①`mcpSurface` 把订阅词原样喂给 `subscribeProjectEvents(..., { subscriptions })`；②需要消费新词的清单在自己的 `subscriptions` 里加词。
3. **IPC 那一跳仍只带 `{kind, at}`**：`next/shell/main.mjs:487` 的 `sendToRenderer(IPC_EVENT.projectEvent, {kind, at})` 会把 `topic`／`path` 削掉，渲染层拿不到细负载。`main.mjs` 不在允许清单内，未改；`ipcContract.mjs` 无需改（通道与信封形状没变）。
4. **索引窗的「最近打开」栏自身的展开态（`recentOpen`）只在组件本地 `ref`，不进 `viewState`**——它是界面开合，不是作者的数据；重启回到默认展开。卷折叠态进 `viewState`，因为那是作者挑的「我这棵树怎么摆」。
5. **两处非允许文件里的陈旧面，登记待处置（本批未动）**：①`next/testing/exportHostDescriptor.mjs:20` 注释仍写 `PANE_FORMS（五态）`；②`next/shell/styles/next-shell.css:166` 的 `.nx-titlebar-immersive-exit` 是死规则（全仓无消费者）。都不影响判定，属文案/样式清账。
6. **一处允许清单外的改动，自报**：`next/shell/PaneFormMenu.vue` 第 12–14 行注释——词表从五值收成三值后，那份「项的来源＝声明 ∩ 词表」的说明会指错，改的是注释文本，**模板、props、判定逻辑一字未动**。留在记录里由调度方追认或回滚。
7. **真窗口实拍未做**（工单验收判据「重启后树展开/选中/最近打开一致」）：本批不起 Electron。UI 层的等价证据是 `shell-ui.spec.mjs` 新增/改造的两条：`最近打开（批次66 任务二）`（存档里带两条记录 → 挂载后列表照摊但**只有一页在册**＝预填不自动开；点一条 → 同一页换装那份文档且列表置顶去重；`close()` 那一页后列表不动）＋ `卷→章两级` 里补的折叠段（`aria-expanded` 翻转 → 本卷两组行隐藏/恢复 → `entry.viewState` 落 `{collapsed:['第一卷']}`，再展开归 `null`）。真窗口的「重启后一致」需调度方按实拍流程接管。
8. **测试改造说明（不是回归）**：`shell-ui.spec.mjs` 的「卷→章两级」原来断言卷标题是静态 `<p>`，任务3 把它做成 disclosure 钮后这条必须改；它一旦在 `unmount()` 之前失败，残留的 `window` keydown 监听会把后面两条窗口用例一起带崩（一记 Esc 收两页），故同批修文案级断言。`carrier-pane-real.spec.mjs` 那条「索引窗文本不含他域条目」限定到**树那一列**——顶部「最近打开」出现刚才点过的那条世界书条目是本批的正常行为（它记的就是「打开过什么」，跨载体共用一栏）。
9. **jsdom 口径备忘**：`v-show`「挂上 `display:none` 再摘掉」之后 jsdom 的 `getComputedStyle` 仍报 `none`（内联 `style` 实测已空），所以折叠用例认 `style` 属性里的声明而不认 `isVisible()`——真浏览器无此问题，用例里已写明。

## 复现

```
cd D:/Pinax-main/Pinax-main
node next/testing/acceptance.mjs                                     # 44/44
node --test "next/tests/*.test.mjs"                                  # 727 pass
npx vitest run --no-file-parallelism --config next/vitest.next.shell.config.mjs   # 201 pass
npm run lint:next                                                    # 零警告
node next/testing/bundleAssertions.mjs                               # 全部通过
# 或直接：npm run verify:next（五段全绿）
```

## §8 调度方验收（Zcode）

- 执行方收口完成但未及门禁复跑（工作流被作者主动停止）——**调度方独立复跑：五段全绿 exit 0**（内核 727/727、界面 201/201、lint 0 警、打包全过——数字与执行方自报一致）。
- 四任务逐一核验：①词表收敛为 dock/split/overlay 三值（PANE_FORM_WORDS 实测）；②fullscreen/immersive 在 12 清单+host-descriptor+paneForms 全部零命中（Q2 落地，批次61 limitation 2 闭合）；③lastOpenFiles 落 workspaceStore（滚动封顶去重）＋AppNext「最近打开」入口（:1358 真相唯一处注释）；④订阅扩展 file-changed/layout-changed 两真实发射点接线（fileService 写钩子 :750＋workspaceStore 落盘），selection.changed 如实登记不做。
- 真窗口实拍（重启树展开/选中/最近打开一致）未做——工作流停止时尚未到该环节，随下一批或作者实览覆盖。
