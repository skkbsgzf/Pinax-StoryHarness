# 批次59 记录：统一窗口化＋布局模板地基——去左栏硬编码（2026-11-01）

> 工单：`docs/plan/pinax-electron-next-m2-batch59-ticket-20261101.md`（v2）。
> 执行方：Qoder CLI。作者两段设计裁定（工单开头全文）为唯一口径。
> 结果：`npm run verify:next` 五段全绿（`EXIT=0`）；窗口／模板／迁移三条主干落地；
> 真窗口实拍四张与 §8 由调度方接管。

---

## 1. 五条铁律 → 落点

| 铁律 | 落点 | 对应测试 |
|---|---|---|
| 一 · 窗口唯一化 | `next/shell/PaneWindow.vue` 新组件：标题栏＋右上统一三钮（收起／分屏／×）＋浮窗拖拽＋四角缩放；`data-window-action` 只有 `collapse`／`split`／`close` 三值 | `统一 chrome：窗口只有收起／分屏／× 三枚…`、`浮窗可拖可缩放…`；`visual-contract` 的 `PaneWindow 是唯一窗口壳` |
| 二 · 中间 doc 区＝窗口管理器 | `AppNext.vue` 的 `openWindows`／`showBoardWindow`／`collapseWindow`／`expandWindow`／`closeWindow`，窗口层 `.nx-window-layer` 按叠序渲染 | `中间 doc 区是窗口管理器…`、`收起＝侧缘标签堆…`、`第一扇占页、后续浮窗…` |
| 三 · 转换流畅 | 浮窗↔最大化↔贴靠↔标签↔关闭是同一记录（`workspace.mjs` 窗态字段）的状态变化，无独立入口、无模式切换 | `最大化＝铺满中间区…`、`分屏＝对半贴…`、`贴靠不留半对…`、`关窗…` |
| 四 · 布局按载体性质走模板 | 新 `next/shell/layoutTemplates.mjs`：`folder`／`web`／`gallery` 注册制；`templateHasTree()` 决定是否渲染 `IndexWindow`；世界书按 `entries-workspace` pane kind 与 `worldbook.` id 前缀认 `web` | `carrier-pane.spec` 的 `世界书是 web 模板…`；`visual-contract` 的 `布局模板是宿主词汇…` |
| 五 · 按钮唯一化 | 批次35 七钮、竖条右键「打开方式」、`FloatingWidget`、`immersive/fullscreen/overlay/dock/split` 独立状态机全部删除；`paneForms.mjs` 只留兼容读 | `统一 chrome…竖条右键不再有「打开方式」菜单`、`未声明 forms 的载体：右键仍无菜单…`；`visual-contract` 的 `workspace v2 窗态轴就位，旧位置四轴与七钮零残留` |

## 2. 文件变更

新增：

- `next/shell/PaneWindow.vue` — 唯一窗口壳（标题／三钮／拖拽／缩放／最大化／贴靠几何）。
- `next/shell/layoutTemplates.mjs` — 宿主侧布局模板注册表（`folder`／`web`／`gallery`）与推断函数。

重写／修改：

- `next/shell/workspace.mjs` — `WORKSPACE_VERSION = 2`；条目字段 `geometry / z / minimized(none|tab) / maximized / tiledWith / tileSide`；读侧 v1→v2 一次性迁移，写侧只写 v2。
- `next/shell/workspaceStore.mjs` — 磁盘层随 v2；仍只经 `workspace:load|save` 通道。
- `next/shell/AppNext.vue` — 窗口管理器（开／收／还原／分屏／最大化／几何／叠序／Esc 收起最上窗）；按模板决定是否渲染 `IndexWindow`；删除七钮、打开方式菜单、沉浸/浮窗等独立容器入口。
- `next/shell/CarrierPaneHost.vue` — 撤除 pane 头部窗口按钮；只承载内容。
- `next/shell/IndexWindow.vue` — 左树降级为 folder 模板的树 pane；世界书不再进这棵树。
- `next/shell/paneForms.mjs` — 旧五形态词表只保留兼容读（host descriptor 与 12 份清单核对用）。
- `next/shell/styles/next-shell.css` — 新增窗口层／窗口壳／侧缘标签样式；删除 `.nx-overlay-widget`／`.nx-overlay-bubble`／`.nx-split-*`／`.nx-form-bar`。
- `next/tests/**`（含 `shell-ui.spec.mjs`、`carrier-pane.spec.mjs`、`workspace.test.mjs`、`pane-forms.test.mjs`、`visual-contract.test.mjs`）— 按新模型重写断言（见 §7）。

删除：

- `next/shell/FloatingWidget.vue` — 并入 `PaneWindow.vue`（`visual-contract` 钉住文件不存在）。

未改动（按工单边界）：`server/**`、`src/**`、协议 `@4` schema、12 份载体清单、右 Agent 栏结构、编辑面本体与写族闸；`next/testing/acceptance.mjs` 与 `next/testing/bundleAssertions.mjs` 本批计数确无变化，未改。

## 3. 窗口模型（workspace v2）

条目键 `<paneId>#<n>`；每条只记窗口状态：

```
{ instance, pane, geometry:{x,y,w,h}|null, z, minimized:'none'|'tab',
  maximized:boolean, tiledWith:instance|null, tileSide:'left'|'right'|null }
```

- 打开文档＝有记录；关闭＝删记录；收起＝`minimized:'tab'`（几何保留）；分屏＝两窗共用同一矩形并互指 `tiledWith`；最大化＝`maximized:true` 且解除贴靠；拖动任一扇贴靠窗即解除贴靠。
- 读侧：`version:1` 的 `placement` 四轴迁移——`dock` 丢弃（它不是开着的窗），`overlay/split` → 浮窗（补缺省矩形），`fullscreen/immersive` → 最大化，`bubble/collapsed` → `tab`；`pinned`／`restore`／`snap` 退役不读。
- 写侧只写 `{version:2, entries}`；下次变更整份重写，不主动改写旧档。

## 4. 布局模板

`layoutTemplateForBoard(board)` 优先级：

1. 载体显式 `board.layout` / `board.template`；
2. pane kind 为 `entries-workspace` 或 board id 前缀 `worldbook.` → `web`；
3. 其余 → `folder`（`gallery` 留给批次60 素材，已注册未启用）。

`templateHasTree(template)` 只对 `folder` 为真——`IndexWindow` 从「每载体标配」降为 folder 模板的一个 pane；世界书（web）没有左栏、没有类别导航树，条目列表／表格／图谱与类别筛选都在核心看板区，详情在其下。

## 5. 删除清单核对（grep 证据）

- `grep -rn "打开方式" next --include=*.vue --include=*.mjs --include=*.json | grep -v next/tests/` → **零命中**（`ActivityRail.vue` 的旧右键上报已删，见 §9-2；`next/tests` 内的命中是「零命中」断言本身）。
- 七钮选择器与「打开方式」菜单在 `AppNext.vue` 零命中（`visual-contract.test.mjs` 的 `for (const gone of [...])` 列表逐个断言）。
- `next/shell/FloatingWidget.vue` 不存在；`.nx-overlay-*`、`.nx-split-*`、`.nx-form-bar` 在 `next-shell.css` 零命中。

## 6. 测试与门禁

`npm run verify:next`（2026-11-01，一次跑完，`EXIT=0`）：

| 段 | 结果 |
|---|---|
| `node next/testing/acceptance.mjs` | `M1 空框架＋M2 真载体验收：35/35 通过` |
| `node --test "next/tests/*.test.mjs"` | pass 649 / fail 0 |
| `vitest run --config next/vitest.next.shell.config.mjs` | 14 文件 / 197 用例全过（shell-ui 88） |
| `npm run lint:next` | 零警告 |
| `node next/testing/bundleAssertions.mjs` | 打包门禁全部通过（a–v 各条） |

## 7. 删改用例对照表（35／44／45／58 及受影响的 28／34／36／44）

> 口径：被删的每个「入口／形态」用例，都在新模型下有一条行为等价的替代物；纯文案/选择器漂移的用例保留原名仅改断言。

### 7.1 批次35（浮窗七钮＋分屏一等公民＋钉住）

| 旧用例（行为） | 处置 | 替代物 |
|---|---|---|
| 浮窗头七钮（放大／缩小／吸附／分屏／固定／＋／×）逐个存在与点击 | 删 | `统一 chrome：窗口只有收起／分屏／× 三枚…`（三钮唯一）＋`收起＝侧缘标签堆…`（缩小→标签）＋`最大化＝铺满中间区…`（放大→最大化） |
| 「吸附」左右半屏↔解除 | 删 | `浮窗可拖可缩放…`（自由几何）＋`分屏＝对半贴…`（贴靠由分屏钮承担） |
| 「固定／钉住」禁拖＋持久化 | 删（`pinned` 退役） | `浮窗可拖可缩放…`（窗永远可拖，位置直接进 v2 存盘） |
| 「＋」再开一份 | 保留语义 | `同一 pane 多开（multiplicity 仍管开窗数量）…`（改走 `hostWorkspace.openInstance`，断言 `#2` 独立几何） |
| 分屏从浮窗钮落「中栏副栏」 | 删（副栏状态机退役） | `分屏＝对半贴…`（当前窗与另一扇各占共享矩形一半，`tiledWith/tileSide` 落盘） |
| 空白卡修复（浮窗挂载补数） | 保留 | `空白卡修复：没访问过大纲板，小窗挂载即触发 loadOutline…`（改 v2 夹具） |
| 浮窗位置记忆 | 保留 | `位置记忆：拖动写进工作区存档的 outline.widget#1…`（改 v2 `entries`） |
| 切板收浮窗 | 保留 | `切板：上一栏的窗收成侧缘标签…`（收＝tab，点标签还原） |
| 大纲小窗 Esc 收起 | 合并 | 并入 `开/收/关…Esc 与收起同义` |

### 7.2 批次44（世界书核心区竖排／类别导航）

| 旧用例（行为） | 处置 | 替代物 |
|---|---|---|
| `世界书核心区竖排——上图表列、下详情；窄栏只留类别导航` | 改 | 同名保留但断言改为：web 模板无索引窗、无类别树；看板区＋详情仍在（`carrier-pane.spec` 与 shell-ui 批次28 段） |
| `世界书类别层：列表按类别分组，表格有类别列，新建下拉＝既有类别` | 改 | 分组／表格列断言保留；「新建下拉＋类别树」改为 `entries-filter-category` 下拉筛选（`全部类别＋既有类别`）；旧项目「顶层」分支删（没有左栏就没有新建入口，批次60 在看板区重建） |

### 7.3 批次45（沉浸态＋解注册）

| 旧用例（行为） | 处置 | 替代物 |
|---|---|---|
| 右键「打开方式」列四形态＋「沉浸」项 | 删 | `统一 chrome…竖条右键不再有「打开方式」菜单`（右键零菜单）＋`未声明 forms 的载体：右键仍无菜单…` |
| 进入沉浸：隐 ActivityRail 与运行坞、顶栏退出钮 | 删（immersive 状态退役） | `最大化＝铺满中间区…`（`fullscreen/immersive` 迁移为 `maximized`；chrome 不再被隐藏） |
| Esc 退沉浸（浮窗先收） | 改 | `Esc 优先关统一二级页…`＋全局 Esc 收起最上非标签窗（`开/收/关…Esc 与收起同义`） |
| 停用载体＝解注册：清 `#1/#n` 的 placement/geometry/pinned | 保留 | `停用载体＝解注册…`（改 v2 字段：minimized／maximized；`hostWorkspace.get(...)` 返回 null；再启用从干净工作区重开） |

### 7.4 批次58（画布接入＋双中栏切换）

| 旧用例（行为） | 处置 | 替代物 |
|---|---|---|
| 画布 pane 形态声明（含 immersive） | 不动（12 份清单禁改） | `paneForms` 兼容读仍认五词；实际打开一律走 `PaneWindow` |
| 同载体双中栏 pane 切换条 | 保留 | `同载体双中栏 pane（批次58 实拍缺口）：顶部出切换条…` 原样通过 |
| 「打开方式」进画布 | 删 | 竖条点选＝开该载体文档窗（`未声明 forms 的载体…` 与统一窗口用例） |

### 7.5 批次28／34／36（世界书与大纲树，仅断言漂移）

| 旧用例（行为） | 处置 | 替代物 |
|---|---|---|
| 大纲树行右键菜单用 Esc 收起 | 改 | Esc 改归窗口（收最上窗），菜单改用 `document.body` 的 `pointerdown` 点外收起 |
| 世界书空态「这一栏还没有条目」 | 改 | 文案不变，落点由索引窗改 `[data-test="entries-workspace"]` |
| 世界书条目表格列／排序／筛选／图谱 | 保留 | 选择器与断言不变（看板区仍是同一组件） |
| 世界书「未建档」行提示 | 改 | 从 `.center` 改 `[data-test="entries-workspace"]` |
| 旧项目「顶层」新建（legacy 分支） | 删 | 见 §7.2 替代物（web 模板无新建入口） |

### 7.6 纯逻辑单测（workspace／paneForms）

| 旧用例（行为） | 处置 | 替代物 |
|---|---|---|
| placement 五档、`restore`／`pinned`／`snap`、气泡/收起两态 | 删 | `workspace.test.mjs`：`v2 往返…`、`收起标签不丢几何…`、`最大化…`、`分屏…`、`窗态词表…`、`v1→v2 迁移…`、`老键迁移…`（`paneForm./overlay.` 搬 `#1` 并删键） |
| 旧词表↔PLACEMENTS 相等 | 改 | `pane-forms.test.mjs`：五档顺序保留（兼容读）、窗态只剩 `none/tab`、清单 forms 去重排序 |

## 8. 记账：大梦 @3 首次打开的 workspace v2 映射

真实旧档 `D:\Pinax-e2e\dameng-px\.pinax\workspace.json`（`version:1`）：

```json
{ "outline.editor#1": { "placement": "split",  "minimized": "none", "geometry": null, "restore": "split", "z": 15, "pinned": false },
  "novel.editor#1":   { "placement": "dock",   "minimized": "none", "geometry": null, "restore": "dock",  "z": 16, "pinned": false } }
```

读侧 `migrateV1Entry` 结果（内存，下一次变更才整份写回）：

```json
{ "version": 2, "entries": {
    "outline.editor#1": { "instance": "outline.editor#1", "pane": "outline.editor",
      "geometry": { "x":…, "y":…, "w":…, "h":… } /* DEFAULT_FLOATING_GEOMETRY */,
      "z": 15, "minimized": "none", "maximized": false, "tiledWith": null, "tileSide": null } } }
```

- `novel.editor#1`（dock）＝正文页本体，不是一扇窗：记录丢弃，不计脏。
- `outline.editor#1`（split）＝保留为一扇浮窗；旧 split 没有搭档（novel 被丢弃）也没有几何，按缺省矩形补齐，可拖动。
- `pinned/restore` 不读；`z` 沿用；`minimized:none` 不变。
- 结论：大梦旧档打开后仍是「正文页＋大纲文档窗」，不会多出/少掉内容；只是大纲窗从「副栏贴靠」变成「可自由摆放的浮窗」。

## 9. 已知边界与偏差（limitations）

1. **世界书新建条目入口暂时缺席**：新建（＋）与类别树原先长在 `IndexWindow`，本批世界书走 `web` 模板后没有左栏，入口随之退场。批次60 在核心看板区重建（工单已把世界书形体排在 60）。本批测试已改为用类别筛选下拉断言既有类别，不伪造入口。
2. **`ActivityRail.vue` 的越界小改**：该文件不在本批允许清单，但铁律五要求竖条右键「打开方式」入口零残留，且 `AppNext` 已无 `context-menu` 监听（死事件）。只删除该 emit／handler／注释，保留 `@contextmenu.prevent`；零行为变化（右键仍不开菜单）。若调度方要求严格零越界，可回退此行并在批次60 收口。
3. **旧注释仍提 `FloatingWidget`**：`next/carriers/outline/manifest.mjs`、`next/kernel/carrierManifest.mjs`、`next/shell/slots.mjs`、`next/shell/RuntimeDock.vue`、`next/shell/AssistantDialog.vue`、`next/doctor.mjs` 的说明文字仍写旧容器名。它们都不在允许清单，`visual-contract` 只对 `AppNext`／CSS 断言零残留；建议批次60 随载体形体一起清。
4. **12 份载体清单未动**：`comic.canvas` 等仍声明 `immersive` 形态；`paneForms` 保留兼容读，实际打开统一走 `PaneWindow`。协议 `@4` 与 `multiplicity/scope` 语义未改。
5. **真实窗口实拍未做**：四张截图（多载体浮窗共存／分屏对半贴／收起标签＋还原／×关闭）按工单由调度方接管；本批只在 jsdom 与产物层验证，未起 Electron、未执行 git。
6. **`gallery` 模板已注册未启用**：素材的图库形体按工单排在批次60；本批只保证注册表与 `templateHasTree` 有测试对应。

## 10. 补记（2026-11-01）：59b 误伤恢复 ＋ 59c 用例对齐多载体共存

### 10.1 59b：AppNext.vue 恢复

- 事故：批次59 验收期调度方脚本手术误切约 30KB（`\n}\n` 锚跨到远处列 0 括号），`AppNext.vue` 自 762 行起语法损坏；59b 只恢复该文件。
- 恢复后接线清单与验证见 [批次59b 工单 §7](./pinax-electron-next-m2-batch59b-ticket-20261101.md#7-执行方回填--8-调度方验收)。
- 两条裁定保持：`collapseBoardWindows` 自动收起调用未恢复（函数本体已删）；竖条右键「打开方式」与七钮零残留。
- 恢复后 `shell-ui.spec.mjs` 重新加载（88 例），内核 649 例恢复。

### 10.2 59c：四条用例改写对照（多载体共存裁定）

> 每条改写处都带一行理由注释：**「批次59b 裁定：多载体共存，旧语义断言作废」**。只改测试，未动任何行为代码。

| # | 旧用例 | 新用例／新期望 | 作废的旧断言 |
|---|---|---|---|
| 1 | 切板：上一栏的窗收成侧缘标签；点标签还原，迷你大纲一行跳到大纲编辑面 | 切板：上一载体的窗保持原位（多载体共存）——切到小说板后 `outline.widget` 仍在场且 `data-window-state` 仍为 `floating`，`outline.editor` 同样仍为 `floating`，窗层无侧缘标签；点迷你大纲一行仍跳大纲栏并出阅读标题 | `outline.widget` 切板后消失、变成 `.nx-pane-window-tab`；需要先点标签才还原 |
| 2 | 中间 doc 区是窗口管理器：多扇窗共存；点窗把叠序抬到最上，窗态不变（铁律二） | 在册窗集合＝`['novel.editor', 'outline.editor', 'outline.widget']`（启动窗＋本次两块）；点编辑窗后按叠序＝`['novel.editor', 'outline.widget', 'outline.editor']`；窗态＝小说 `maximized`，两扇大纲窗 `floating` | 在册窗只有 `['outline.editor', 'outline.widget']`；编辑窗「第一扇最大化」 |
| 3 | 收起＝侧缘标签堆：多扇收起依次排开，点一枚只还原那一扇（铁律二） | 前置不再预设上一板窗已收起：只收大纲两扇后，在册窗剩 `['novel.editor']`，标签两枚 `['outline.editor', 'outline.widget']`（top 120／156）；点第二枚只还原 widget，剩一枚标签 | 收两扇后窗层为 0、标签三枚（含 `novel.editor`） |
| 4 | 第一扇占页、后续浮窗：先开的文档窗最大化，再开的小窗浮在上面可叠（铁律二） | 页位由启动即在场的小说窗占着（`maximized`）；点大纲栏只多开一扇 `floating` 的大纲编辑窗（`width: 760px`）；再开迷你大纲仍 `floating`；三扇在册 | 点大纲栏后大纲编辑窗是「第一扇」并最大化；在册窗 2 扇 |

附带收益：第 1 条旧断言首先失败会让用例在 `wrapper.unmount()` 前中止，泄漏的捕获期 Esc 监听会连带把下一条「Esc 优先关统一二级页」的窗收掉；四条改绿后该连带失败自行消失（无需改该用例）。

### 10.3 验证（2026-11-01，执行方实跑）

| 段 | 结果 |
|---|---|
| `node next/testing/acceptance.mjs` | 35/35 |
| `node --test "next/tests/*.test.mjs"` | 649 / 0 fail |
| `vitest run --config next/vitest.next.shell.config.mjs` | **194 / 197**（`shell-ui` 88/88；余 3 条见 §10.4） |
| `npm run lint:next` | 0 警告 |
| `node next/testing/bundleAssertions.mjs` | a–v 全过 |

### 10.4 遗留（未越工单边界）

同一「切板后只剩一扇窗」的旧语义另有两处，不在 59c 允许清单，执行方未改：

1. `next/tests/carrier-pane.spec.mjs:1127`「世界书是 web 模板…」：`wrapper.find('.entry-text')` 取到的是仍开着的正文窗；建议限定 `[data-test="entries-workspace"] .entry-text`（同文件该用例后续两处同理）。
2. `next/tests/carrier-pane.spec.mjs:1656`「竖条七格…」：`activePane()` 取 `.pane[data-pane-id]` 的第一扇（叠序最低）；共存下应取叠序最高窗，如 `wrapper.findAll('.nx-pane-window').at(-1).find('.pane')`，并把该用例里「另一栏编辑器不在」的断言限定到活动窗。
3. `next/tests/carrier-pane-real.spec.mjs:139`「世界书与设定各占一栏…」：同 1 的 `.entry-text` 限定问题。

修法均为「限定查询范围」，不放宽任何断言、不删用例；待调度方授权后随下一批落地。

## §8 调度方验收

（待调度方补：真窗口实拍四张核对、五条铁律逐条判读、信用账。）
