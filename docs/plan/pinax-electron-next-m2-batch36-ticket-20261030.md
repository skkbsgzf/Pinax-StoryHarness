# 批次36 执行工单：条目型载体 Dataview 表格＋知识图谱（2026-10-30 夜）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash），经 workflow 编排派发
> 调度方：Zcode（验收、门禁、提交；夜间自主推进）
> 作者指令（原话）：「对于第二种类型的载体，其实就是条目，比如禁用词表、文风约束、规则，或者是数据库、世界书设定、时间线等等。这些内容本身具有一定的数据形式，完全可以用 Obsidian 的 Dataview 等类似格式去呈现。在展示时，就不需要呈现成左边一个文件夹列表，每一行是一条……也没有达到我们之前要求的 Wiki 形式。你可以把它做成 Dataview 多维表格的形式，也可以以 IG 的形式作为一个知识图谱去展现。这部分内容也是能被 Agent 感知到的。」「Pinax 原版的代码里面，应该已经带入了一些类似的数据表格和图表之类的代码了。你看一下是不是移植的时候忽略了。」

## 0. 调度方调研结论（已核实，写给你省时间）

- **原版确有可迁的图代码**：`src/components/geography/LocationTreeMap.vue`（147 行，**d3-hierarchy 的 stratify＋tree 布局**，SVG 渲染 links/nodes）——`d3-hierarchy ^3.1.2` **已在 package.json**，复用不算新增依赖。`GraphCanvas.vue`（749 行 canvas）与 `WorldMapVoronoi`（worker 引擎）偏重，本批不迁。
- **条目型载体的数据已在**：批次34 后世界书 13 条真数据带 `cat/type/keys/tags/relations/summary/字数`——这就是多维表格的列；`relations[].to` 就是图谱的边。Agent 感知已通（context.mjs 批次34 递归修补）。
- **本批的载体范围**：世界书（人物/编年/设定/真相层/剧作——含时间线性质的编年）。禁用词表/文风约束/规则是**散文文档**，不具数据形式，维持文档面（作者列表里的「规则」类属第一类载体，不硬套表格）。

## 1. 任务一：Dataview 多维表格（世界书栏表格视图升级）

批次28 的表格视图（entriesView）升级为 Dataview 式：
- **列**：名称／类别（cat）／类型（type）／关键词／字数／摘要（既有）——**可排序**（点列头切换 升/降/默认）
- **筛选行**：一个筛选输入（名称/关键词/摘要的包含匹配，前端过滤）＋类别下拉（全部/各 cat）
- **分组**：按 cat 分组的小节头（与列表视图一致的组语义）；组头显示条数
- **行点击**：打开条目（既有 openEntry 按 path）
- 数据源：既有 `data.entries`（不新增工具调用）；排序/筛选纯前端
- 表格样式沿用批次28 token 词汇；排序指示（▲/▼）用字符

## 2. 任务二：知识图谱视图（relations 成图）

- 视图切换从「表格视图/列表」扩为 **列表／表格／图谱** 三态（同一 entriesView 存储，值多一档）
- **图谱**：新建 `next/shell/EntryGraph.vue`——SVG 实现（不引新依赖）：
  - 节点＝条目（圆点＋名字标签，按 cat 着色——类别→颜色的映射表写死六档 token 邻近色，图例在角落）
  - 边＝`relations[].to`（按名字匹配节点；匹配不到的边如实标注在图例计数里，不画幽灵节点）
  - **布局用 d3-hierarchy**（已在依赖）：以「被引用最多」的条目为根跑 tree() 径向布局（radial），孤立节点沿外圈排布——不需要 d3-force
  - 交互：hover 高亮邻边；点击节点打开条目；缩放平移（viewBox 变换，滚轮＋拖拽画布）
  - 图例：类别色样＋「N 条关系边未落图（目标不存在）」如实计数
- Agent 感知：图谱与表格同源 `data.entries`，无新工具；确认 relations 未落图的条目在 warning 里可见即可

## 3. 任务三：Wiki 形态衔接（小步）

- 表格/图谱行点击打开的条目阅读态（nx-rendered-md）加**正文内锚**：条目名做 H1，关键词行进 meta（已有）——阅读态本身不再动（wiki 大改版另批，本批只保证三态视图都指向它）

## 4. 测试

- shell-ui：三态切换持久化（列表/表格/图谱）；表格排序点击换序；筛选输入过滤行数；类别下拉过滤；图谱 SVG 在场＋节点数＝条目数＋图例；孤边计数如实
- 单测（如有纯函数）：布局计算抽纯函数（radialLayout(nodes, edges) → 坐标），环/孤点不崩
- **真数据验收**（调度方做）：dameng-px 13 条真条目（5 真相层+3 剧作+3 设定+1 编年+1 人物）——图谱必须有 真相层 集群与跨类边

**允许文件**：`next/shell/IndexWindow.vue`、`next/shell/EntryGraph.vue`（新）、`next/shell/entriesView.mjs`、`next/shell/useBoardData.mjs`（如需）、`next/shell/styles/next-shell.css`、`next/tests/shell-ui.spec.mjs`、`next/tests/entries-view.test.mjs`（新，布局纯函数）、`next/tests/visual-contract.test.mjs`（如需登记）。**不许改**：载体工具/内核/fileService/package.json（d3-hierarchy 已在）。

## 5. 门禁

`npm run verify:next` 五段全绿。

## 6. 边界

- **不新增 npm 依赖**（d3-hierarchy 已在；不用 d3-force/d3-selection）
- 图谱是**只读总览**——编辑仍走条目编辑面；不做图上拖拽改关系（另批）
- 世界书之外不铺（规则/约束是散文；剧本是第一类载体）
- 新 CSS 全走 token；执行方不 commit/push、不启停 electron
