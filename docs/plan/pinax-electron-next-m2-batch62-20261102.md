# 批次62 记录：命令面＋手势（Obsidian 框架轮·桩1）（2026-11-02）

> 工单：`docs/plan/pinax-electron-next-m2-batch62-ticket-20261102.md`（Q3 裁定：面板键位＝Ctrl+P，提案审阅让到 Ctrl+Shift+R；Q4：第三方 JS 不开）。
> 执行方：Qoder CLI。前置：批次61（中心区页底座，`gesture` 形参留桩）已收口。
> 结果：`npm run verify:next` 五段全绿（`EXIT=0`）——acceptance ／ node:test 689 例 ／ vitest 196 例（14 文件，含 `shell-ui.spec.mjs` 85 例）／ `lint:next` 零告警 ／ bundleAssertions 全过（**未改任何计数**，理由见 §6）。
> 本批**不新增任何行为**：53 条载体命令全是既有动作的另一个入口，§2 的镜像对照表逐条给出落点 file:line，评审按这张表核。

---

## 1. 六块任务 → 落点

| 任务 | 落点 | 对应测试 |
|---|---|---|
| 1 十一份清单补 `contributes.commands` | 11 × `next/carriers/*/manifest.mjs` 的 `contributes.commands`，共 53 条；每条带**清单注释里的映射表**（`run` 串→既有动作）；id 命名空间 `<载体短名>.<动作>`，title ≤60 中文字；校验走 @4 既有的 `validateCommands`（`carrierManifest.mjs:431-463`），合同一个字没改 | `command-face.test.mjs`「命令面总数落在 40–55」「每载体 3–6 条」「id 命名空间＝载体短名」「title 不超长」「run 是字符串且动词在闭集内」 |
| 2 命令通道 | `next/shell/ipcContract.mjs:103` 新通道 `commandList: 'pinax:agent:command:list'`；`commandTable()`（`:350`）＝应用菜单动作 ∪ `registry.commands()`，纯数据（`run` 只可能是字符串——函数过不了结构化克隆）；`acceptedMenuIds()`（`:344`）从「MENU_TEMPLATE 拍平的死集合」改成 **∪ registry.commands() 每次现算**（载体可启停），唯一口径、全文件一处；未知 id 照旧拒（`:820`）；`menuIds` 改 getter（`:832`） | `command-face.test.mjs`「command:list ＝菜单∪注册表」「menu:invoke 接受集是活的」「未知 id 仍拒（文案含\'应用菜单\|命令表\'）」「get menuIds 随注册表变」 |
| 3 `CommandPalette.vue`（新） | `next/shell/CommandPalette.vue`：`Ctrl+P` 唤起、子串模糊（`haystack.indexOf`，无拼音）、Enter 经命令路执行、Esc 走 `focusTrap.mjs` 同一枚实现；表来源＝`command:list`（`:726` `loadCommandTable`），桥不在时按同样两条数据源本地重算（`localCommandEntries` `:659`），**不另立第三份清单**；第三块＝当前焦点页可用的形态动作（`pageCommandEntries` `:696`，与页签右键同一份 `FORM_ACTIONS`／`PAGE_ACTIONS`）；挂载 `AppNext.vue:2323`；样式落在 `next/shell/styles/next-shell.css` 的 `.nx-palette*` | `command-face.test.mjs`「面板源码契约：props/emits/data-test/焦点陷阱/禁碰项」；`shell-ui.spec.mjs` 批次62「Ctrl+P 唤得起面板：三条数据源都在表里，过滤、Enter 执行与 Esc 双重消费」 |
| 4 `hotkeys.mjs`（新）＋ `.pinax/hotkeys.json` | `next/shell/hotkeys.mjs`：`HOTKEYS_FILE:23`、`HOTKEYS_VERSION:22`、默认表 `:66`（**只收编点名的高频三条**）、`normalizeAccelerator:126`、`matchHotkey:169`、`findHotkeyConflicts:217`、`normalizeHotkeys:256`／`parseStoredHotkeys:297`／`serializeHotkeys:311`／`applyBinding:325`；通道侧 `ipcContract.mjs:510/520`：**冲突即拒**（整份不落盘）＋ `noteHotkeyIssue:376` 往 `serviceLogPool` 记 warn；坏档→默认表＋记账；总线在 `AppNext.vue:1682` `onWindowKeydown` | `command-face.test.mjs`「默认表三条／白名单恰好三条」「归一化与跨平台匹配」「改键闸：NOT_BINDABLE／BAD_ACCELERATOR／CONFLICT」「存档往返与坏档回落」「hotkeys 通道：未接入如实报缺、冲突写入被拒且文件字节不变、warn 落池」 |
| 5 手势接通（解批次61 的桩） | `openTarget.mjs:41-42` `GESTURE_FORMS=['floating']`／`GESTURE_ACTIONS=['close']`；`resolveOpenTarget` 的 `gesture` 真吃值：`withForm(:122)` 只往落点答案上补一个 `form`，**五档判定一条不改**；`close` 走 `close-page(:110)`，实例不在页列表→`block:GESTURE_NO_TARGET`；认不出的组合→`GESTURE_FORM_UNSUPPORTED`／`GESTURE_UNSUPPORTED`。入口：Alt＋点页签／竖条格＝`onGestureKeyClick`（`AppNext.vue:1710`），中键点页签＝`onGestureMiddleDown`（`:1732`）；两者都是**壳层捕获阶段**监听（`:2025/:2026`，卸载时 `:2053/:2054`），因为 `ActivityRail.vue`／`PaneTabStrip.vue` 不在允许文件里；语义写进 `openTarget.mjs:18` 注释头＋`spec v2` §4.3 后一行附录 | `command-face.test.mjs`「手势经 resolveOpenTarget 的路由（reveal／open-page 带 form，close-page 命中既有页，杂串一律 block＋明确 reason）」；`shell-ui.spec.mjs` 批次62「Alt＋点页签／竖条＝以浮窗态执行同一动作；中键点页签＝只关那一页」（界面确有入口传值） |
| 6 记账断言（不打回） | `next/testing/acceptance.mjs` 末段两条 `record(...)`（见 §6）＋一行分布 `console.log` | 门禁自身输出（`✔ 批次62 记账①/②`） |

---

## 2. 命令镜像对照表（53 条，评审按此逐条核「不新增行为」）

`run` 串的词汇只有七个动词，每个动词指向**一个已经存在的函数**（`AppNext.vue:752` `resolveCommandRun`，认不出的串如实回 `false` 并把原因写进 notice）：

| 动词 | 指向的既有落点 | 这个落点今天已有的界面入口 |
|---|---|---|
| `board:<载体id>` | `AppNext.vue:1784` `selectBoard` | 竖条点这一格（`ActivityRail @select`） |
| `pane:<paneId>` | `AppNext.vue:1105` `routeOpen`（批次61 起的唯一开窗通路） | 点页签／左树开一章／蓝链 |
| `data:<方法>[:参数]` | `AppNext.vue:182` `activeData()` 上同名方法＝`useBoardData.mjs` 导出面 | 索引窗换树重列／编辑位上那枚按钮（逐条见下表） |
| `section:<节id>` | `AppNext.vue:485` `openSection` | 统一二级页左列点那一节 |
| `menu:<菜单id>` | `AppNext.vue:632` `invokeMenu` → 主进程 `menu:invoke` | 标题栏菜单那一行 |
| `page:<动作>` | `AppNext.vue:1399` `applyFormAction` | 页签／标题栏右键形态菜单 |
| `overlay:<paneId>` | `AppNext.vue:1413` `toggleBoardOverlay` | 索引窗「悬浮」钮 |

> 本批实际用到的动词：`board`／`pane`／`data`／`section`／`menu` 五种；`page`／`overlay` 在闭集里但没有被清单使用（`page` 由面板自己按焦点页现算，不需要清单声明；`overlay` 的载体面板入口今天仍在索引窗那枚钮上）。

### 小说 `pinax.carrier.novel`（6）

| 命令 id | title | run | 既有动作落点 |
|---|---|---|---|
| `novel.open-board` | 打开小说栏 | `board:pinax.carrier.novel` | `AppNext.vue:1784 selectBoard` |
| `novel.open-editor` | 打开正文这一页 | `pane:novel.editor` | `AppNext.vue:1105 routeOpen`（清单 `panes` 里 `novel.editor`） |
| `novel.reload-chapters` | 重新载入章节目录 | `data:loadChapters` | `useBoardData.mjs:287`；已有入口＝`IndexWindow.vue:488` 换树重列 |
| `novel.export-current` | 导出当前文档… | `section:export` | `AppNext.vue:485 openSection('export')`；节在 `:481` |
| `novel.export-book` | 整本导出（纯文本） | `data:exportBookFile` | `useBoardData.mjs:497`；已有入口＝`IndexWindow.vue:372` |
| `novel.review-proposals` | 提案审阅… | `menu:project.reviewProposals` | `menus.mjs:30` 那一项（键位本批改 `CmdOrCtrl+Shift+R`，动作本体未动） |

### 大纲 `pinax.carrier.outline`（5）

| 命令 id | title | run | 既有动作落点 |
|---|---|---|---|
| `outline.open-board` | 打开大纲栏 | `board:pinax.carrier.outline` | `selectBoard` |
| `outline.open-editor` | 打开大纲编辑这一页 | `pane:outline.editor` | `routeOpen` |
| `outline.reload` | 重新载入大纲 | `data:loadOutline` | `useBoardData.mjs:1796`；已有入口＝`IndexWindow.vue:490`／`CarrierPaneHost.vue:930` |
| `outline.new-draft` | 新建大纲（起一份草稿） | `data:startOutline` | `useBoardData.mjs:1843`；已有入口＝`IndexWindow.vue:767`「新建大纲」钮 |
| `outline.save` | 保存大纲 | `data:saveOutline` | `useBoardData.mjs:1992`；已有入口＝`CarrierPaneHost.vue:881` |

### 构思 `pinax.carrier.notes`（4）

| 命令 id | title | run | 既有动作落点 |
|---|---|---|---|
| `notes.open-board` | 打开构思栏 | `board:pinax.carrier.notes` | `selectBoard` |
| `notes.open-editor` | 打开构思编辑这一页 | `pane:notes.editor` | `routeOpen` |
| `notes.reload` | 重新载入构思清单 | `data:loadNotes` | `useBoardData.mjs:658`；已有入口＝`IndexWindow.vue:492`／`CarrierPaneHost.vue:908` |
| `notes.save` | 保存当前构思 | `data:saveNote` | `useBoardData.mjs:700`；已有入口＝`CarrierPaneHost.vue:880` |

### 世界书 `pinax.carrier.worldbook`（6）

| 命令 id | title | run | 既有动作落点 |
|---|---|---|---|
| `worldbook.open-board` | 打开世界书栏 | `board:pinax.carrier.worldbook` | `selectBoard` |
| `worldbook.open-entries` | 打开条目这一页 | `pane:worldbook.entries` | `routeOpen` |
| `worldbook.reload` | 重新载入条目清单 | `data:loadEntries` | `useBoardData.mjs:1400`；已有入口＝`IndexWindow.vue:494`／`CarrierPaneHost.vue:936` |
| `worldbook.edit-entry` | 编辑当前条目 | `data:editEntry` | `useBoardData.mjs:1478`；已有入口＝`EntryDetailPanel.vue:170`「编辑」 |
| `worldbook.save-entry` | 保存当前条目 | `data:saveEntry` | `useBoardData.mjs:1537`；已有入口＝`CarrierPaneHost.vue:886/887` |
| `worldbook.filter-all` | 按全部分类列出条目 | `data:setEntriesFilterCat:` | `useBoardData.mjs:1599`；已有入口＝`EntriesCategoryTree.vue:29`（`__all` 传空串，参数段允许为空） |

### 剧本 `pinax.carrier.script`（5）

| 命令 id | title | run | 既有动作落点 |
|---|---|---|---|
| `script.open-board` | 打开剧本栏 | `board:pinax.carrier.script` | `selectBoard` |
| `script.open-editor` | 打开剧本编辑这一页 | `pane:script.editor` | `routeOpen` |
| `script.reload-list` | 重新载入剧本清单 | `data:loadScripts` | `useBoardData.mjs:970`；已有入口＝`IndexWindow.vue:501` |
| `script.edit-script` | 编辑当前剧本 | `data:editScript` | `useBoardData.mjs:1013`；已有入口＝`CarrierPaneHost.vue:1587`「编辑」 |
| `script.save-script` | 保存当前剧本 | `data:saveScript` | `useBoardData.mjs:1031`；已有入口＝`CarrierPaneHost.vue:884` |

### 设定与资料 `pinax.carrier.dossier`（6）

| 命令 id | title | run | 既有动作落点 |
|---|---|---|---|
| `dossier.open-board` | 打开设定与资料栏 | `board:pinax.carrier.dossier` | `selectBoard` |
| `dossier.open-editor` | 打开资料与约束这一页 | `pane:dossier.editor` | `routeOpen` |
| `dossier.reload-documents` | 重新载入资料清单 | `data:loadDocuments` | `useBoardData.mjs:846`；已有入口＝`IndexWindow.vue:497` |
| `dossier.reload-rules` | 重新载入约束清单 | `data:loadRules` | `useBoardData.mjs:750`；已有入口＝`IndexWindow.vue:498`／`CarrierPaneHost.vue:913` |
| `dossier.edit-document` | 编辑当前资料 | `data:editDocument` | `useBoardData.mjs:905`；已有入口＝`CarrierPaneHost.vue:1553`「编辑」 |
| `dossier.save-rule` | 保存当前约束 | `data:saveRule` | `useBoardData.mjs:792`；已有入口＝`CarrierPaneHost.vue:882` |

### 素材 `pinax.carrier.material`（4）／漫画 `comic`（5）／视频 `video`（4）／体验 `experience`（4）／联机 `online`（4）

记录型五栏共用同一条 `data:` 三件套（`loadRecords` 的参数段＝本栏的 key，`useBoardData.mjs:1094/1138/1160`；已有入口＝`IndexWindow.vue:504`、`CarrierPaneHost.vue:923/1645/1641`）：

| 命令 id | title | run | 既有动作落点 |
|---|---|---|---|
| `material.open-board` | 打开素材栏 | `board:pinax.carrier.material` | `selectBoard` |
| `material.reload-records` | 重新载入素材清单 | `data:loadRecords:material` | `useBoardData.mjs:1094` |
| `material.edit-record` | 编辑当前素材 | `data:editRecord` | `useBoardData.mjs:1138` |
| `material.save-record` | 保存当前素材 | `data:saveRecord` | `useBoardData.mjs:1160` |
| `comic.open-board` | 打开漫画栏 | `board:pinax.carrier.comic` | `selectBoard` |
| `comic.open-editor` | 打开漫画记录这一页 | `pane:comic.editor` | `routeOpen` |
| `comic.open-canvas` | 打开 Toonflow 画布 | `pane:comic.canvas` | `routeOpen`（清单 `panes` 里的 app 档 pane，批次56 p2） |
| `comic.reload-records` | 重新载入漫画页清单 | `data:loadRecords:comic` | `useBoardData.mjs:1094` |
| `comic.save-record` | 保存当前漫画页 | `data:saveRecord` | `useBoardData.mjs:1160` |
| `video.open-board` | 打开视频栏 | `board:pinax.carrier.video` | `selectBoard` |
| `video.reload-records` | 重新载入镜头与成片清单 | `data:loadRecords:video` | `useBoardData.mjs:1094` |
| `video.edit-record` | 编辑当前镜头记录 | `data:editRecord` | `useBoardData.mjs:1138` |
| `video.save-record` | 保存当前镜头记录 | `data:saveRecord` | `useBoardData.mjs:1160` |
| `experience.open-board` | 打开体验栏 | `board:pinax.carrier.experience` | `selectBoard` |
| `experience.reload-records` | 重新载入体验会话清单 | `data:loadRecords:experience` | `useBoardData.mjs:1094` |
| `experience.edit-record` | 编辑当前体验会话 | `data:editRecord` | `useBoardData.mjs:1138` |
| `experience.save-record` | 保存当前体验会话 | `data:saveRecord` | `useBoardData.mjs:1160` |
| `online.open-board` | 打开联机栏 | `board:pinax.carrier.online` | `selectBoard` |
| `online.reload-records` | 重新载入联机房间清单 | `data:loadRecords:online` | `useBoardData.mjs:1094` |
| `online.edit-record` | 编辑当前联机房间 | `data:editRecord` | `useBoardData.mjs:1138` |
| `online.save-record` | 保存当前联机房间 | `data:saveRecord` | `useBoardData.mjs:1160` |

**对照表的机检**：`command-face.test.mjs` 里有两条把这张表钉住的用例——① 动词闭集＋每个动词在 `AppNext.vue` 源里指得到那个既有落点函数；② 计数不变式（把每份清单的 `raw.contributes.panes/settings` 与顶层 `raw.tools` 逐载体核一遍，确认这六块面**一条都没长**），这就是「只镜像既有动作」的可复现证据。

---

## 3. 命令面口径（一处实现，两处消费）

- 唯一口径＝主进程 `commandTable()`（`ipcContract.mjs:350`）：`MENU_TEMPLATE` 拍平（19 条）∪ `registry.commands()`（53 条）＝ **72 条**；`owner` 对菜单行是 `app.menu`，对载体行是载体 id；`run` 全是字符串（`slimForIpc` 会剪函数，所以清单里即便写了函数也过不去这条通道——`registry.commands()` 早就是字符串口径）。
- 渲染层的回落（`localCommandEntries` `AppNext.vue:657`）读的是**同样两条既有声明**（`MENU_TEMPLATE` 与 `view.carriers[].commands`），不是第三份清单；桥在就一律以通道为准。
- `menu:invoke` 的接受集改成活的（`acceptedMenuIds` `:344`，每次现算——载体可被启用／停用），未知 id 的拒绝文案没变；原生顶层菜单模板一个字没改，载体命令进的是**命令表**不是菜单（C5 纪律没松）。
- 键位显示：通道给的是菜单默认值，面板实际显示走 `hotkeys:load` 那一份（`acceleratorOf` `AppNext.vue:685`）——两处读同一张表，不各写一份。

---

## 4. 快捷键：收编的只有点名的高频三条

首版 `.pinax/hotkeys.json`（`serializeHotkeys(defaultBindings())` 的实际产物）：

```json
{
  "version": 1,
  "bindings": {
    "palette.open": "CmdOrCtrl+P",
    "workspace.collapse-top": "Esc",
    "project.reviewProposals": "CmdOrCtrl+Shift+R"
  }
}
```

- 默认表从 `MENU_TEMPLATE` 派生菜单那一条（`:67`），所以 Q3 改键只改模板一处、面板与总线跟着走；`bindableIds()`＝这三条，越界一律 `NOT_BINDABLE`。
- 归一化：修饰键别名（Ctrl／Command／⌘／super…）收成 Electron 词表；`normalizeAccelerator:126` 对**认不出的键名整条丢弃并记账**（写注释说明理由：拼错的键名会顶掉一条能用的绑定却永远按不出来＝静默死命令，宁可回落默认）。
- 冲突即拒：`findHotkeyConflicts:217` 按**等价类**求交（`CmdOrCtrl+K` 与 `Ctrl+K` 在 Windows 上是同一个物理组合，按不出的那条命令就是死命令），命中就整份拒写、往 `serviceLogPool` 记 warn（`source.id='hotkeys'`）——替作者选一个赢家＝悄悄改他的键位，不做。
- 匹配同理走等价类（`equivalentsOf:186`）。**本批在这里抓出一个真缺陷**：`matchHotkey` 原来拿 `CmdOrCtrl+…` 的规范串直接比对事件串，Windows／Linux 上按 Ctrl+P 永不命中，面板根本唤不起来；修后两条平台都有断言。
- 坏档三条路照 `settingsStore.parseStored` 口径：非 JSON→默认表＋`HOTKEYS_BAD_JSON`（不覆盖原文件）；表外／非法条目→丢弃＋`HOTKEYS_DROPPED_n`；version 不符→warning 继续读、下次整份重写。
- 39 处散 keydown **没动**：收编的只有这三条，其余仍归各组件自己。

---

## 5. 手势：解批次61 留下的 `gesture` 桩

| 手势 | 传的值 | `resolveOpenTarget` 的结果 | 落地 |
|---|---|---|---|
| Alt＋点页签 | `{form:'floating'}` | 判定不变（`reveal`／`replace-page`／`open-page`／`raise-tab`）＋ `form:'floating'`（`withForm:122`） | `routeOpen` 里 `hostWorkspace.open(..., { form: decision.form ?? 'page' })`，已 floating 的再跟一句 `setForm` |
| Alt＋点竖条格 | 同上（格＝这块板的中心 pane） | 同上 | 同上 |
| 中键点页签 | `{action:'close', instance}` | `close-page`（`target:110`）；实例不在页列表／属另一 pane→`block:GESTURE_NO_TARGET` | 宿主那句既有的 `close`，只关被点那一页 |
| 认不出的组合 | 杂串 | `block:GESTURE_FORM_UNSUPPORTED`／`GESTURE_UNSUPPORTED` | 界面能解释为什么什么都没发生 |

- 一次都不新增形态值：形态轴仍是 §4.2 那三值（`page/floating/tab`），`GESTURE_FORMS` 只有 `floating`。
- 中键用 `mousedown` 而不是 `click`：Chrome 对中键根本不派发 `click`（写成 click 就是个按不出来的入口）。
- 监听器在壳层**捕获阶段**（`AppNext.vue:2025/2026`）：普通点击照常冒泡给组件自己，一次都不拦；带手势的那一下才 `preventDefault`＋`stopPropagation`。卸载对称 `:2053/2054`。
- Esc 的双重消费有真断言了：面板开着时 Esc 先关面板，叠序最高的那扇浮窗一条都不动；面板关掉后 Esc 才回到批次61 的收窗语义。

---

## 6. 记账两条（只留数，不打回）

`next/testing/acceptance.mjs` 末段，实跑输出：

```
✔ 批次62 记账①：command:list 非空，且每条载体命令都能解析出 commandOwner（不打回，只留数） — 总数=72 载体=53 归属可解=true run 全字符串=true
✔ 批次62 记账②：命令 id 命名空间与 forms／gesture 词表无冲突，全量 id 不重复（不打回，只留数） — 词表=dock/split/overlay/fullscreen/immersive/page/floating/tab/close 撞名=无 重复=无
〔批次62 记账〕载体命令 53 条，应用菜单动作 19 条；逐载体分布：
  novel=6 outline=5 notes=4 worldbook=6 script=5 dossier=6 material=4 comic=5 video=4 experience=4 online=4
```

- 记账②的词表并了四份：`PANE_FORMS`（协议五值）＋ `PAGE_FORMS`（v3 三值）＋ `GESTURE_FORMS` ＋ `GESTURE_ACTIONS`；载体短名里没有一个撞进来（`page`／`close` 这类词也没被用作命名空间）。
- `bundleAssertions.mjs` **一处计数都没改**：它钉的是 `BUILT_IN_CARRIER_PLUGINS.length===11`、认领 pane 22／keyed 1、工具面 19/21、资产与 AGENT.md 存在性、宿主描述符 views 9／forms 5——`contributes.commands` 不动这些面的任何一条（批次62 没加 pane、没加 tool、没改描述符），跑完仍「打包门禁：全部通过」。这就是工单那句「计数写理由」的答案：**无需写计数，因为无一命中**。

---

## 7. limitations（做不到／没做的，如实登记）

1. **`.pinax/hotkeys.json` 的真落盘没接上主进程**：`session.loadHotkeys`／`saveHotkeys` 需要 `next/shell/main.mjs` 里建 store 并注入，而 `main.mjs` 与 `next/index.mjs` 都不在本工单允许文件里。今天这条通道**如实报缺**（「快捷键服务未接入…这条通道现在只报缺」），净化／冲突判定／记账路径全部就位并被测试覆盖（`command-face.test.mjs` 用 Map 存储 fake 出跨实例往返与「冲突写入一个字节都不落盘」）。差的只有主进程那一段接线，留给下一批（一行 `hotkeysStore` 注入）。
2. **渲染层今天只读不写键位表**：本批没有改键位的界面（设置里没有那一节，`SettingsSection` 系文件不在允许清单内），所以 `AppNext` 只有 `hydrateHotkeys()`（`:1745`）一条读口；写侧 `applyBinding`＋`hotkeys:save` 是合同侧与 `hotkeys.mjs` 的能力，没有 UI 触发点。**故意不留一个「点了没反应」的假口**——曾写在 `AppNext` 里的 `rebindHotkey()` 包装因无消费者已删除（lint `--max-warnings 0` 也不允许它躺着）。
3. **三条需要输入区面的动作没进命令面**：新建章、新建条目、资料检索依赖索引窗的草稿行／搜索框（`IndexWindow.vue` 不在允许文件里，拿不到那套本地状态）。清单因此只镜像「无需额外输入即可执行」的既有动作，条数落在 3–6 区间内（工单允许的区间，不是缺失）。
4. **原生菜单 accelerator 与渲染层总线可能双命中**：`project.reviewProposals` 现在同时挂在 Electron 原生菜单项（`menus.mjs:30`）和 `onWindowKeydown` 上。两条路落的是同一个 `menuActions` 函数（幂等：开同一节／同一面板第二次是 no-op），实测不出错，但**理论上是两次触发**。收编其余菜单项前要先把这条定成单点（建议：原生菜单项只留展示，派发一律走渲染层）。
5. **面板自带背板，没复用 `WorkbenchModal`**：批次61 的可视合同把 `WorkbenchModal` 钉成「只有 `SettingsModal` 挂载」。面板另立背板是为了不拆那条合同；`.nx-palette*` 全部走 token，不写死颜色（`visual-contract` 仍全过）。
6. **手势入口的可达性受组件钩子形状约束**：壳层靠 `.nx-page-tab[data-page-instance]` 与 `.nx-ribbon-item[aria-label]` 认目标。这两个选择器／属性是组件既有稳定钩子（页签栏与竖条的 a11y 契约），但若哪天 `ActivityRail.vue` 改掉 `aria-label` 语义（比如换成 tooltip 属性），Alt＋点竖条会**静默失效**——现在没有断言钉住「组件必须带这两个钩子」。建议下批把这两个钩子写进 `visual-contract.test.mjs`。
7. **面板过滤只做子串**（工单点名这一档）：没有模糊子序列、没有拼音、没有按最近使用排序。`Ctrl+Shift+P` 让位后老习惯的作者需要重绑，而重绑界面缺（见 2）。

---

## 8. 禁止边界对账（工单「不许碰」逐条自证）

| 边界 | 实况 |
|---|---|
| 不新增任何行为 | 53 条全部指向 §2 表里那七个既有函数；机检＝动词闭集＋计数不变式 |
| 不动协议 schema | `carrierManifest.mjs` 未改（`commands` 校验 @4 已有）；对外 `host-descriptor.json` 未改 |
| 不动写族闸／文件服务／expectedRevision | `kernel/**` 未改一行 |
| 第三方 JS 不开（Q4） | 装载路径没动；`BUILT_IN_CARRIER_PLUGINS` 仍是静态数组，`acceptance.mjs` 那句 `length === 11` 也未改 |
| 不动 `server/**`／`src/**` | 未触碰 |
| 不加 npm 依赖 | `package.json` 未改 |
| 39 处散 keydown 只收编点名的高频项 | 总线只认 `bindableIds()` 那三条，其余组件的监听器一个没删没加 |
| 不起 Electron、不执行 git | 全程未起进程、未跑任何 git 命令 |
