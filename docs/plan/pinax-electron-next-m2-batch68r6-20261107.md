# 批次68-R6 执行记录（2026-11-07）

> 工单：正文实时编辑渲染＋右栏停靠结构化（浮层越界治理）。执行方：Qoder CLI。
> 本文件为 §7 执行方回填；§8 归调度方验收。

## §7 执行方回填

### 7-1 任务落点

**任务一 右栏停靠结构化**（先做）

- 复核实况（口径纠偏，写在前）：工单任务一的落点是「RuntimeDock 从浮层改占位」——但 68-R2 已把悬浮球钉进中心区，本轮逐句核对，`RuntimeDock.vue`／`.dock`／`.col-dock` **早就是占位兄弟列**（AppNext 结构：`col-center` → `resizer` → `col-dock`，坞宽＝`dockWidth` 状态 → `:style` 宽度 → 拖拽 320..680 clamp，同一条链路，与工单要的一样）。真正的越界不在坞的**形态**，在坞的**宽度可被挤没**这一环：缺了占位化闭环，正文里一条不折行的长稿能把中心区顶到 min-content 宽，把 `flex: 0 0 auto`＋显式宽度的坞整体**顶出可视区**——现象与「右缘控件压在坞上」一样，根因是没给中心区设可缩下界。故任务一落地为：钉死既有占位链路（判据⑳，声明级）＋补上这唯一缺的一环（CSS `min-width: 0`）。

- 落地动作（三处）：
  1. `next/shell/styles/next-shell.css` `.col-center` 补 `min-width: 0`：长内容只在中心区内滚，坞永远占着自己那一段版面。这是占位化的另一半——「中心区可缩」。
  2. **判据⑳（`visual-contract.test.mjs`，声明级）**钉四件事：① 绑定链（`dockWidth` ref 唯一出处 → `.col-dock` 的 `:style` 宽度绑上去 → `Math.min(680, Math.max(320, next))` 拖拽闸在位）；② 排版（`.col-dock` 必须 `flex: 0 0 auto` 且绝不 `position: fixed/absolute`；`.col-center` 必须 `min-width: 0`）；③ 右缘控件不出栏（`.nx-tools` 走面板内 `absolute` 而非视口 `fixed`，挂点 `.nx-tools-anchor` 必须 `relative`；分页条 `.chapter-pager` 是流内件、不许领定位规则）；④ 结构（`col-center` 与 `col-dock` 之间只隔一条 resizer——坞还是占位兄弟列，不是浮层）。
  3. 真窗 rect 判据（半屏分屏＋坞展开时三控件与坞零相交）归调度方——见 limitations。

- 浮层清单审计（任务1②）：`grep position:(fixed|absolute)` 全 shell 版面（CSS＋各 SFC scoped），逐条归属如下表。规则口径：**弹层类（transient）可覆盖内容；常驻／半常驻类只许留在自己栏内**。判定＝`归属`＋`是否越栏`，越栏的登记理由。

  | # | 选择器 | 定位 | 类别 | 归属栏 | 允许覆盖谁 | 越栏？ |
  |---|---|---|---|---|---|---|
  | 1 | `.nx-menu-popup` | absolute | 弹层 | 标题栏 | 下拉菜单盖正文（transient） | 否（弹层） |
  | 2 | `.nx-rail-status-dot` | absolute | 常驻 | 竖条格内 | 只在本格右上，不吃指针 | 否 |
  | 3 | `.nx-index-window`（窄屏） | absolute | 半常驻 | 左栏覆盖式抽屉 | 窄屏才浮起，`78vw` 上限不碰右栏 | 否 |
  | 4 | `.nx-pane-group.is-overlay-group` | absolute inset:0 | 浮窗容器 | 中心区窗口层 | 铺满窗口层（不含坞） | 否 |
  | 5 | `.nx-pane-window` | absolute | 半常驻 | 窗口层 | 浮窗态在窗口层内拖拽 | 否 |
  | 6 | `.nx-collapse-orb` | absolute | 半常驻 | 中心区右下（68-R2） | 只在本列角上 | 否 |
  | 7 | `.nx-collapse-orb-badge/-dot` | absolute | 常驻 | 球体内 | 只钉球角 | 否 |
  | 8 | `.nx-pane-snap-preview` | absolute | 弹层（拖拽预览） | 窗口层 | 拖拽瞬时提示，不落位即消失 | 否 |
  | 9 | `.nx-pane-window-resize` | absolute | 常驻 | 浮窗四角 | 只在窗体角上 | 否 |
  | 10 | `.nx-context-menu` | **fixed** | 弹层 | 视口 | transient 右键菜单可盖内容 | 否（弹层） |
  | 11 | `.nx-tools`（快捷词／取名） | absolute | 弹层 | 文档头挂点下 | 面板内 `right:0`，出不了中心区 | 否 |
  | 12 | `.nx-palette`（命令面板） | **fixed** | 弹层 | 视口 | transient 模态，可盖内容 | 否（弹层） |
  | 13 | `.nx-editor-wrap > .editor-area`／`.nx-focus-mask` | absolute | 常驻 | 编辑面内 | 段落遮罩只在本 textarea | 否 |
  | 14 | `AssistantDialog`（sessions/typeahead/plus-menu/model-list） | absolute | 弹层 | 坞内 | 只在本对话框内浮起 | 否 |
  | 15 | `EntryGraph.vue`（`.nx-entry-graph-empty`） | absolute | 常驻 | 图右上角 | 只在本图角落，不吃指针 | 否 |
  | 16 | `IndexWindow`（add-toggle／section-actions／export-menu） | absolute | 半常驻 | 索引窗区头 | 只在本栏区头右缘 | 否 |
  | 17 | `MaterialGallery.vue`（`.nx-material-gallery`） | absolute inset:0 | 半常驻 | 中心区窗口层 | 铺满窗口层（不含坞），窗户浮其上 | 否 |
  | 18 | `WorkbenchModal.vue` | **fixed** | 弹层 | 视口 | 统一二级页模态，transient 可盖内容 | 否（弹层） |

  结论：**零越栏常驻层**——所有 `fixed`（3 处）都是 transient 模态／弹层（命令面板／设置弹窗／右键菜单），按规则可覆盖内容；`absolute` 全部钉在自己栏内，右栏坞不被任何常驻／半常驻层压住。本轮补的 `min-width:0` 关掉「长稿顶宽中心区、把坞挤没」这唯一一条隐性越栏路径。清单本身归人裁，判据⑳钉的是这份纪律的声明级样本。

**任务二 正文默认实时编辑渲染**（`CarrierPaneHost.vue`＋`useBoardData.mjs` 补登记）

- 走工单点名的两档之一——**整块 textarea 接管＋失焦渲染（最简单那档）**，理由（§7 要求给）：① 分块级实时渲染要么上 contenteditable 要么上 tiptap，两者都要在「渲染 DOM ⇄ 源文」间做 md 往返——而工单禁止边界把「mdRender 管线／wikiLinkRanges」划为不许动，分块实时档与这条边界正面撞；② textarea 接管复用批次43 既有的「源文 ⇄ mdRender 阅读面」同一管线，编辑面与阅读面共享同一份 `data.draft`，一个字都不新增往返路径。落点选段首（散文形态下点哪段就接那段），字级落点未做，见 limitations。
- 点入即改（判据㉑交互声明）：
  - 阅读面容器 `data-test="chapter-rendered"` 挂 `data-click-to-edit="chapter"`（判据㉑看这条声明在位）。
  - `onChapterRenderedClick`：蓝链**先吸掉点击**（走 openKnowledge/openEntry，词表与锚点同页纪律照旧），其余点击＝就地接稿 `enterChapterEditingFrom(event)`。
  - 「编辑」入口钮退役（`data-test="chapter-edit"` 绝迹）；「取消」钮与保存 chip 保留（工单例外两支）。
- 落点映射（近似口径，工单要求说清）：第 n 个渲染块 ↔ 页源文按空行分的第 n 段（`chapterBlockStart`）；点空白处／块数越界＝整页末尾。含空行的围栏代码是已知例外（段首会偏到围栏后第一段——偏段内起点，不丢字）。接稿后 textarea 用隐藏镜像量光标纵坐标滚到那一行（与打字机滚动同一把尺），「在同一段落位置接管」量的是这个滚动落点。
- 收口两条走同一份 commit（不长第二套）：
  - 失焦 `onEditorBlur`：焦点走去**本面板**的控件（取消钮／chip 重试）时不插一脚（分屏时另一格 `.pane` 不算，靠 `currentTarget.closest('.pane').contains(relatedTarget)` 判栏）；焦点出栏＝保存回渲染态。
  - Ctrl+S：`onPaneKeydown` 正文编辑态分支改走 `commitChapterEditing()`（与失焦同一条），不再走裸 `saveCurrent`。
  - `commitChapterEditing`：有未落盘改动才 `await save()`（只点开一眼不推修订号，与自动保存指纹纪律同口径）；落盘没成（版本冲突／写失败，chip 报 is-error）留在编辑态，稿子在作者手里、退路是 chip 上重试；落盘成功才 `chapterEditing=false`，分页档回到改稿那一页（页码按光标现算，不回页 1）。
- 分页兼容（工单③）：
  - 编辑态下分页条整块让位（`v-if="!chapterEditing && textPagesReading && chapterPageCount > 1"`，判据㉑钉谓词）——textarea 吃整份草稿＝整章展开。
  - 快捷词／取名插入走「点入即改」同一条入口：`insertAtCaret` 先 `expandChapterForEditing()` 再落字（半截草稿上落字＝下次保存抹后段，补载失败即停手不插）。
- 整章展开（`useBoardData.loadFullChapterDraft`，越界补登记，见 7-4）：进编辑前把 `openChapter`（maxChars 20000）只载了前段的大稿补完整。口径＝**「多载入」不是「改动」**：不走 setDraft（不置脏、不起自动保存计时器），拼完把指纹对齐到新基线（`markBaseline` 与 openChapter 同一套），故展开本身不让「未保存的改动」亮起、不推修订号（工单禁边界「自动保存语义一字未动」守住）。尾段按 offset／maxChars 分段读（工具单次上限 200000 字）；读失败或读到一半修订号变了（外部改过盘）一律原样返回原因、草稿一个字节不动，truncated 语义照旧——界面继续按「只载入前段」纪律走，且编辑态根本开不成。

### 7-2 测试同步与新增

- 新增机器判据 ×2（判定只增）：`visual-contract.test.mjs`〔批次68-R6 门禁⑳〕＋〔门禁㉑〕。
- 新增用例 ×7：`next/tests/chapter-live-edit.spec.mjs`（点入即改／蓝链吸点击不开编辑／失焦保存回渲染态且没改过不推修订号／Ctrl+S 同一条收口＋版本冲突留编辑态／取消钮 blur 不替它保存／大稿翻到草稿外页点入先补载 textarea 拿整章且提示随之退场／整章展开后落盘写回整章不抹后段且保存回改稿那一页）。
- 断言事实同步（判定逻辑不动）：
  - `enterEditing` 辅助：`chapter-edit` 钮退役后回落点 `chapter-rendered`（构思／大纲／约束仍是按钮，原样）。
  - `carrier-pane-real／review-chapter／writing-pane／writing-preview／writing-tools` 五处 `[data-test="chapter-edit"]` 点击 → 点 `chapter-rendered`。
  - `carrier-pane.spec`「③ 只载入前段不自动保存」一条**重钉**：拦法从「进得了编辑但不落盘」变成「补不齐就根本进不了编辑态」，save 计数仍 0、底部说明句仍在（这条闸的语义没松，只是前移到入口）。
- **没有任何判据放宽**——门禁⑯⑰⑱⑲、八块空态指南计数、status-tokens、usage「未回报」文案断言全部原样在场。

### 7-3 记账指标

- 浮层清单：18 条定位层全登记（§7-1 表）；`fixed` 3 条均 transient，`absolute` 常驻／半常驻全部留栏内；**越栏常驻层 0**（本轮补 `min-width:0` 关掉唯一一条隐性顶宽路径）。
- 正文编辑入口：`chapter-edit` 常驻钮 1 → 0（判据㉑）；入口改成阅读面本体点击＋`data-click-to-edit` 声明。
- 整章展开读数：>20000 字章进编辑，额外 `pinax_chapter_read`（offset 补载）段数＝⌈(总字数−20000)/200000⌉（保险丝 200 段封顶）；展开后 `truncated`→false、`doc-meta-hint`「只载入前段」提示随之退场（用例⑥断言）。
- tiptap 引入＝未采用，无 bundle delta；渲染管线（mdRender／wikiLinkRanges）一字未动（禁边界）。

### 7-4 越界与补登记

- **一处越界（补登记）**：`next/shell/useBoardData.mjs` 新增 `loadFullChapterDraft()`（＋导出）。原因：整章展开要「多载入不置脏、对齐指纹基线」，`setDraft`（置脏＋起自动保存计时器）做不到、markBaseline 不导出，只能在这一层补一个只读拼接＋重置基线的入口。改动＝只加这一个函数与一行导出，**不碰**任何既有语义（写族闸／提案轨／AUTOSAVE_DELAY_MS 一字未动）。工单允许清单未含 useBoardData.mjs，此处如实补登记。
- 无其它越界。改动文件＝`CarrierPaneHost.vue`、`useBoardData.mjs`（补登记）、`styles/next-shell.css`、`next/tests/{visual-contract.test.mjs, carrier-pane.spec.mjs, carrier-pane-real.spec.mjs, review-chapter.spec.mjs, writing-pane.spec.mjs, writing-preview.spec.mjs, writing-tools.spec.mjs, chapter-live-edit.spec.mjs(新)}`、本执行记录。`AppNext.vue`／`RuntimeDock.vue` 复核实况后判无需改（坞早是占位列），未动。

### 7-5 门禁读数表（npm run verify:next exit 0）

| 段 | 基线（68-R5） | 本轮 |
|---|---|---|
| 验收 acceptance | 44/44 | 44/44 |
| 内核单测 | 830/830 | **832/832**（+2 新判据⑳㉑） |
| 外壳界面测 | 244/244（16 文件） | **251/251（17 文件）**（+7 新用例，1 文件 chapter-live-edit；6 处点击与 1 条③属同步，不计新增） |
| eslint（--max-warnings 0） | 0 警 | 0 警 |
| 打包门禁 | 全过 | 全过 |

### 7-6 limitations

1. 未启动 Electron（工单禁令）。任务一真窗判据（半屏分屏＋坞展开时正文三控件 rect 与坞零相交）本会话只到**声明级**（判据⑳钉绑定链＋坞不定位＋中心区可缩＋右缘控件不出栏），rect 量取需真窗复拍，归调度方。
2. 任务二落点在**段首**非字级（textarea 无 caretRangeFromPoint 与源文字偏移的无损映射，禁用 contenteditable 下拿不到点击的字级列）。含空行的围栏代码块段首会偏到围栏后第一段（偏起点、不丢字）。
3. 「整块 textarea 接管＋失焦渲染」＝工单点名的两档之一（最简单档，理由见 §7-1 任务二）；非分块级实时渲染。若作者要分块实时，需重开 mdRender 管线边界（现禁），另批裁。
4. 自动保存语义（AUTOSAVE_DELAY_MS=1500、指纹基线、写族闸）一字未动；`commitChapterEditing` 只在**有 pendingSave**时才落盘，未落盘时「未保存的改动」句与自动保存计时器照旧由 useBoardData 那本账管。
5. `loadFullChapterDraft` 补载中途外部改过盘（修订号变）＝拒合并、编辑态开不成、`truncated` 原样；这一拒绝路径的界面文案「请重新载入该章」走 `chapterPageError`（阅读态页提示位），未新开常驻噪声行。
6. 记录型／其它载体（构思／大纲／约束／资料／剧本／记录）的「点入即改」**本批不下**（工单口径：只 novel.editor 这批；其余等作者）——仍是头部「编辑」钮切换，`enterEditing` 对它们保持按钮路径。
7. 项目硬规则要求的 `testing-verification`／`docs-status-handoff`／`commit-conventions` 等仓库内 skills 不在本会话 Skill 可用列表——按工单口径以 `verify:next` 官方五段代替等价验证；`docs/STATUS.md` 一行记账不在允许文件清单，未写，建议调度方验收时一并落；未 commit（工单禁令）。

---

## §8 调度方验收（Zcode · 2026-11-07）

**判定：通过。** 门禁独立复跑 exit 0：44/44 · 832/832 · 251/251 · eslint 0 · 打包过（＋新门禁⑳㉑＋chapter-live-edit.spec 7 例）。

### §8-1 真窗三连验（ux-sweep/png/152-153）

1. **零相交**：Agent 坞左缘 x=1334；分页条/快捷词钮右缘均 ≤1320——**零相交**（对半分屏＋坞开启实测）。执行方对根因的修正（`.col-center` 缺 `min-width:0`，长内容把坞推出视野）经此实测成立，浮层 18 行清单在册。
2. **点入即改**：`编辑` 钮已消失（判据㉑）；正文容器带 `data-click-to-edit="chapter"`；点击正文 → 整章 textarea 接管（2698 字源文）、焦点就位、滚动保位；失焦 → 渲染态回归。快捷词/取名 `insertAtCaret` 同入口。
3. **编辑态观感**：整块 textarea（源文可见 `# 第一章`）——工单允许的 fallback 路线，§7-1 已述理由（mdRender 禁改＋tiptap 未引入）。**作者如要段落级 live-render（打字即渲染），需下批以 tiptap 或块级方案另立**——本批口径如实登记为「点入即改、失焦即渲染」。

### §8-2 越界追认

`useBoardData.mjs` 新增 `loadFullChapterDraft()`（事前登记 §7-4）：补载不置 dirty、revision 漂移拒绝合并、200 段保险丝——语义干净，追认。
