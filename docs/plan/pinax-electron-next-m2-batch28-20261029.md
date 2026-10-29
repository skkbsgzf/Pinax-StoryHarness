# Pinax-Electron-Next M2 批次28：大纲编辑器主体＋世界书关系边＋条目表格视图（2026-10-29）

> 作者指令：「接下来是剧本，大纲和世界书」。剧本载体批次26 已落地；本批补大纲与世界书的编辑器主体。
> 执行方式：Codebuddy CLI（deepseek-v4.1-flash，326 轮，约 12 分钟）。调度方独立复跑门禁、截图、提交。

## 1. 交付

**大纲编辑器主体**：`outlineTree.mjs` 纯函数（删节点连同两端连线、同级上移/下移、BFS 深度——悬空边/自环/重复 id 只让相关节点归 0，环不转圈）；索引窗层级缩进阶梯（`·` 点标记下线）；编辑面加上移/下移（首末行禁用）/删除节点＋节点备注 textarea（200 字，Ctrl+S 同样触发整份保存）；删光节点收掉草稿（空 nodes 存不进 outline.json）。全部只改 outlineDraft，按保存才落盘（既有口径）。

**世界书关系边**（把工单C 划给关系图域的 relations 开进 meta 口）：`META_FIELDS` 加 `relations`（≤32 条；`to` 非空 ≤80、`type/stance` ≤32、`covert` 布尔、`weight` 数字；`src` 与陌生字段明确拒收）；read 返回归一后的关系五栏；保存复用 `shared/worldbookFileContract.js` 的序列化（`links` 纯 id 层 ∪ `relations.to` 去重合成不被破坏）。编辑面 meta 下加「关系」区：目标（input＋条目名 datalist）/类型/立场/暗线 checkbox/删行＋「加一条关系」；阅读态逐行显示「目标 · 类型 · 立场」。

**条目表格视图**：世界书栏索引窗「表格视图/列表」切换（localStorage `entriesView.<projectRoot>`，visual-contract 登记先例）；表格列＝名称/类型/关键词/字数/摘要（截 40 字）；行点击与列表同一 openEntry；`pinax_worldbook_list` 顺手补了 summary 字段（表格列的数据来源，同一份读取，不新增工具调用）。

## 2. 门禁（调度方独立复跑）

验收 **16/16** · 内核单测 **284/284**（＋8）· 外壳界面测 **93/93**（＋4）· eslint 0 警 · 打包 a–k 全过。

## 3. 截图

`png/63-light-outline-editor.png`（大纲三层缩进树＋备注＋上移/下移/删除）、`64-light-entry-relations-read.png`（阅读态关系行「目标 探究 · 追问者」）、`65-light-entry-relations-edit.png`（编辑态关系区五件套）、`66-light-entries-table.png`（表格视图四列＋切换）、`67-dark-outline-editor.png`（深色大纲）。

## 4. 诚实边界

- **大纲契约仍是两个文件名**（outline.json／大纲.md）：作者真稿 大纲/001-004.md 两个都不匹配，编辑器对它是「既没有」——导入/转换另行排期，本批不动契约。
- 关系是**整份覆盖**：只活在 relations 层、不在 links 层的目标会随被替换/清空的那条关系一起消失；`weight` 界面无此栏（改别的字段时原样带回）；`src` 读回丢弃、保存不收。
- 节点备注 200 字上限只由 maxlength 守（工具侧 nodes 透传无校验），超长粘贴被浏览器截断。
- 关系目标 datalist 用固定 DOM id：分屏双实例同名，但选项同源无功能影响。
- 关系自动推导/共现建议（老版 observer 那套）不做——只做手编辑口。
- 深度语义从「有坏连线整份平铺」改为「逐节点算，算不出归 0」：无根环从整份平铺变为环内 0、环外子树照常。
