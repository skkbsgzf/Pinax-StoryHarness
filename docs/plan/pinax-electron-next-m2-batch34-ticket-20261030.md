# 批次34 执行工单：世界书类别层——真实数据适配第一档（2026-10-30）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash），经 workflow 编排派发
> 调度方：Zcode（验收、门禁、提交）
> 依据：**dameng-px 真实数据摸底**（作者指令：用真项目才能知道哪里做得不够好）——
> 大梦 13 个世界书条目全部在 `世界书/人物|编年|设定/` 三个子目录里，`pinax_worldbook_list` 返回 **0 条**（书面全盲）；契约层 13/13 解析 OK（文件合法，工具瞎）。另：章节标题带 `NNN-` 排序前缀。

## 0. 现状锚点（先读再动手）

- `next/carriers/worldbook/tools.mjs`：list 用 `fileService.list({ pluginId, dir: '世界书' })` **只列一层**；read/save 的 `file` 参数只认顶层文件名。
- **fileService 的子路径能力已存在**（工单B，测试 `file-service.test.mjs`「目录递归归认领者」）：list/read/write 接受「dataDir 名＋子路径」，归属与作用域仍按一级目录判——是载体工具没用上，不是文件服务缺。
- **验收场**：`D:/Pinax-e2e/dameng-px`（大梦真数据）。测试夹具照它造：世界书/人物|编年|设定 三层、13 条、真 frontmatter。
- 批次28 的条目表格视图（`entriesView`）；批次33 的区头「＋→临时行内输入」新建交互。
- `next/shell/CenterSlotHost.vue`：批次33 留的尾巴——`.center-head` DOM 还在（CSS 隐藏中），本批允许文件，**顺手整块删除**＋退役那条 CSS 规则与 visual-contract 断言。

## 1. 任务一：世界书工具面升维（递归＋类别）

`pinax_worldbook_list`：
- 递归列 `世界书/` 下的全部 .md（子目录各一层即可——真实结构就是一层类别目录；更深的不猜，遇到记 warning）
- 每条目带 `cat`（相对 `世界书/` 的一级子目录名；顶层文件 cat 为空串）
- `path` 字段带子路径（`人物/人物·柯秒（冷穿越剧版）.md`），read/save 按它定位；兼容旧顶层文件名（无子目录的老项目照旧）
- 排序：cat 字典序→文件名字典序；返回 `categories: [名称…]` 供 UI 分组

`pinax_worldbook_read`：`path` 支持子路径；返回体加 `cat`。
`pinax_worldbook_save`：`file` 支持子路径（新建时必须带类别目录；已有条目改稿原样带回 path）；保存仍走三道闸（子路径归属判一级目录，工单B 语义）。

**不动**：frontmatter 契约（`shared/worldbookFileContract.js` 零改动——13/13 已合法）、meta 口、关系层。

## 2. 任务二：索引窗按类别分组＋表格加类别列

- 列表视图：按 `categories` 分组渲染——每组一个 `workspace-nav-section` 小节头（人物／编年／设定），条目行照旧（名字＋hover）；无类别的旧顶层条目归「未分类」组（仅当存在时渲染）。
- 表格视图（批次28）：加「类别」列；行点击打开不变。
- 新建（区头 ＋→临时输入）：临时行加一枚小类别下拉（选项＝既有子目录；没有子目录时只有「顶层」）——默认第一个；选中的类别决定新建落点。
- 章节标题剥前缀：`pinax_chapter_list` 的 `title` 剥离 `^\d{1,3}-` 前缀（如 `003-倒带`→`倒带`；`file` 字段保留原名不动）。只动 title，不动文件名与排序。

## 3. 任务三：CenterSlotHost 尾巴收口

- `.center-head` 的 `<header>` DOM 整块删除（批次33 的 CSS 隐藏与 visual-contract 断言一并退役/改写为「DOM 不存在」断言）。

## 4. 测试

- worldbook 工具：dameng-px 形状夹具（三层 13 条）——list 全量可见＋cat 正确＋categories 齐；read 子路径；save 新建落类别目录＋改稿原 path；顶层旧项目兼容（无子目录项目行为不变）。
- IndexWindow：分组渲染（三组＋行数）、表格类别列、新建类别下拉、章节标题无前缀。
- CenterSlotHost：center-head DOM 不在。

**允许文件**：`next/carriers/worldbook/tools.mjs`、`next/carriers/novel/tools.mjs`（仅 title 剥前缀）、`next/shell/IndexWindow.vue`、`next/shell/useBoardData.mjs`、`next/shell/CenterSlotHost.vue`、`next/shell/AppNext.vue`（如透传需）、`next/shell/styles/next-shell.css`、`next/tests/carrier-worldbook.test.mjs`、`next/tests/carrier-novel.test.mjs`、`next/tests/shell-ui.spec.mjs`、`next/tests/carrier-pane.spec.mjs`、`next/tests/visual-contract.test.mjs`。**不许改**：frontmatter 契约、fileService、内核、package.json。

## 5. 门禁

`npm run verify:next` 五段全绿（基线：内核 403、界面 109、打包 a–l）。

## 6. 边界

- **真实稿零风险**：dameng-px 只读打开验证；不跑任何对原稿 `D:/Projects/大梦` 的写入
- 不做：类别改名/移动条目跨类别（后续批）、多级嵌套类别、知识索引改动（旧线索引本来就是全树扫，验证即可）
- 执行方不 commit/push、不启停 electron
