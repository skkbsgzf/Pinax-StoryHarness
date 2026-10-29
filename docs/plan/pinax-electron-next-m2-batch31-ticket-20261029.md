# 批次31 执行工单：P18 文档为主——编辑面去框化＋控件退位（2026-10-29）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash），经 workflow 编排派发
> 调度方：Zcode（验收、门禁、提交）
> 作者指令（原话）：「大部分组件全部都是中间带一个框，把内容往里塞，还会加很多按钮去挤正文实际的位置……我们是一个面向 Obsidian 的 doc 类组件，应该是以文档为主。就算有按钮，也应该在文档的一些不显眼的位置去展示。」

## 0. P18 文档为主合同（本批立约，写进视觉合同测试）

1. **编辑面＝文档本身**：正文（textarea／渲染 md）满幅铺在窗格底色上——无 border、无卡片背景、无圆角；只留呼吸留白。**禁止「中间一个框把内容装进去」**。
2. **控件三分**，此外不得有第三种常驻控件：
   - **窗格头部一行**：标题＋meta（版本/字数）＋至多两个 quiet 操作（编辑/取消级），右端对齐；
   - **按需浮现**：树行右键菜单（node 操作）、hover 显形 icon；默认不可见；
   - **Ctrl+S＋保存 chip**：保存的唯一常驻形态。
3. **常驻按钮行一律取消**；pane-hint 提示文案删除（信息进 placeholder/tooltip）。
4. **元数据默认折叠**：编辑面里关键词/标签/摘要/关系这类 meta 编辑，收进一行可展开的「条目信息」层（照 Obsidian properties：默认一行，点开才是字段），不许堆在正文上方。
5. **面板型界面不受此合同约束**：Pi-Agent 对话、设置二级页、提案审阅的两版对照（两份文档需要视觉分隔）。

## 1. 现状锚点（先读再动手）

- `next/shell/CarrierPaneHost.vue`：七个 viewKind。**常驻 control-primary 保存按钮恰 3 处**：outline（~383）、rule（~423）、entry（~586）——全部拆除（Ctrl+S＋chip 已覆盖，批次19 H1）。
- `.editor-area`（styles/next-shell.css:696）：`border: 1px solid var(--hairline-soft); border-radius: var(--radius-control); padding: 18px 20px` ——框的来源。改：去 border/radius，背景透明，留 padding。
- outline-editor 脚注 6 按钮（上移/下移/删除节点/加同级/加子节点/保存，~367-386）＋ pane-hint；标题与备注是两只 boxed `.nx-field`。
- entry 编辑态：关键词/标签/摘要三只 boxed 字段＋关系区（每行 4 输入＋删行＋「加一条关系」）全堆在正文上方；底部 保存＋取消。
- IndexWindow 树行右键基建已有（`onRowContextMenu`，批次24 的打开方式菜单）——大纲行要复用同一条通路加 node 操作。

## 2. 各面改造清单

**通用（所有编辑态/阅读态正文）**：`.editor-area`／渲染 md 满幅去框；编辑态的 取消 → 头部右端 quiet 文字钮（与 chip 同排）；「编辑」入口维持头部右端（已是）；pane-hint 全删。

**outline-editor（最重）**：
- 中栏只剩文档：节点标题＝一行**无边框大字**（新 `.doc-title`：透明背景、无 border、字号升一档走 token），备注＝标题下无边框第二行（新 `.doc-field` 修饰类，不改全局 `.nx-field`）；
- 脚注 6 按钮全拆：上移/下移/删除/加同级/加子节点 → **大纲树行右键菜单**（IndexWindow 复用打开方式菜单的通路；菜单项带 data-test）；树区标题行加一枚 hover 显形的「＋」（新节点，加在末尾同级）；
- Ctrl+S 照旧（备注框里也已触发）；pane-hint 删。

**entry-detail 编辑态**：关键词/标签/摘要/关系区全部收进一行「条目信息 ▸」折叠层（默认收起，收起时显示「关键词 N · 关系 M」摘要）；展开后字段照旧（那里的「加一条关系/删行」允许保留——折叠后不占正文）；正文满幅去框；底部 保存/取消 拆（保存=chip，取消=头部 quiet）。

**rule-editor / document-detail / script-editor / notes-editor**：同通用处理——去框、拆常驻保存、hint 删、（若有）底部按钮退头部。

**proposal-review**：两版对照结构不动（P18 第 5 条豁免），只把两段正文的外框统一收窄。

## 3. 断言（进 visual-contract.test.mjs 或 shell-ui.spec）

- CarrierPaneHost 模板 `control-primary` 出现次数＝0（三只保存按钮拆净）；
- `.editor-area` 样式块无 `border:`／`border-radius:` needle；
- 大纲树行右键菜单含 上移/下移/删除/加同级/加子节点 五项（data-test）；
- entry 编辑态默认折叠（信息行在场、字段不在 DOM；展开后字段在场）；
- outline-editor 不再有 `outline-move`／`outline-remove`／`outline-add` 常驻按钮（选择器从模板消失，操作走菜单）。

**允许文件**：`next/shell/CarrierPaneHost.vue`、`next/shell/IndexWindow.vue`、`next/shell/styles/next-shell.css`、`next/shell/useBoardData.mjs`（菜单动作接线如需）、`next/tests/shell-ui.spec.mjs`、`next/tests/carrier-pane.spec.mjs`、`next/tests/visual-contract.test.mjs`。**不许改 package.json／内核／载体工具**。

## 4. 门禁

`npm run verify:next` 五段全绿（基线：内核 395、界面 104、打包 a–l）。

## 5. 边界

- **只挪位置与去框，不删功能**：每个被拆的按钮其能力必须在新位置可达（右键菜单/折叠层/chip），少一处都算失败——评审员按此逐条对照。
- 不新增 npm 依赖；不改内核/工具/fileService；不动 AssistantDialog 与设置二级页（面板形是合理的）。
- 右键菜单是唯一新增交互面——照批次24 打开方式菜单的样式与通路，不另起一套。
- 新 CSS 全走 token；执行方不 commit/push、不启停 electron。
