# 批次28 执行工单：大纲编辑器主体＋世界书关系边＋条目表格视图（2026-10-29）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash）
> 调度方：Zcode（验收、门禁、提交）
> 作者指令：「接下来是剧本，大纲和世界书」。剧本载体批次26 已落地；本批补大纲与世界书的**编辑器主体**。

## 0. 现状锚点（先读这些再动手）

- `next/shell/IndexWindow.vue`：大纲树是平铺列表（`·` 点标记父子，`{{ index }}.` 编号），无缩进层级。
- `next/shell/CarrierPaneHost.vue` `outline-editor` 面：改标题＋加同级/加子节点＋整份保存；**没有删除、没有排序、没有节点备注**。
- `next/carriers/outline/tools.mjs`：outline.json 契约 `{ nodes: [{id,title,…}], edges: [{from,to}] }`，nodes 透传（多余字段原样带回）；只有 `大纲.md` 散文稿时返回原文＋warning（**注意：作者真稿是 大纲/001-004.md，两个契约名都不匹配，这是已知边界，本批不改这个契约**）。
- `next/carriers/worldbook/tools.mjs`：`META_FIELDS = ['keys','tags','summary']`——**`relations` 被工单C 划进关系图域没开口**；frontmatter 双层关系合同见 `shared/worldbookFileContract.js`：富关系层 `relations: [{to,type,stance,covert,weight,src}]`＋纯 id 层 `links`（序列化时 ∪ 去重）。
- `next/shell/useBoardData.mjs`：outlineDraft（整份深拷贝，保存才落盘）、entryMetaDraft（keys/tags/summary 三栏）。

## 1. 任务一：大纲编辑器主体

**1a. 层级缩进树**（IndexWindow）：用 edges 算每个节点的深度（默认深度 0；环与悬空边不崩——深度按可达算，算不出的归 0），缩进渲染替代 `·` 点标记。样式用 padding-inline-start 阶梯（布局尺寸可按像素，字号仍走 token）。

**1b. 节点操作**（CarrierPaneHost 的 outline-editor 面，编辑区脚注一排）：
- 新建 `next/shell/outlineTree.mjs` 纯函数模块：`removeNode(draft, index)`（连同该节点的所有边）、`moveNode(draft, index, delta)`（同级内上移/下移，重排 nodes 数组；跨层不动）、`nodeDepth(nodes, edges, index)`
- 编辑面加三个按钮：删除节点（带确认？**不带**——有整份草稿兜底，不保存就不落盘；按钮文案「删除节点」）、上移／下移
- 全部只改 outlineDraft，按保存才写盘（现有口径）

**1c. 节点备注**：节点加 `note` 字段（nodes 透传，无需改工具合同）——中栏编辑面标题下加一个备注 textarea（「这一节要写什么」一句话口径，maxlength 200），随整份保存走。

**测试**：`next/tests/outline-tree.test.mjs`（新）——removeNode 连边删、moveNode 边界（首个上移/末个下移是 no-op）、nodeDepth 环/悬空边不崩；IndexWindow 缩进与操作按钮进 shell-ui.spec（挂载断言）。

## 2. 任务二：世界书关系边编辑（把 relations 开进 meta 口）

**2a. 工具面**（`next/carriers/worldbook/tools.mjs`）：
- `META_FIELDS` 加 `'relations'`：数组，每项 `{ to: 非空字符串≤80, type?: 字符串≤32, stance?: 字符串≤32, covert?: 布尔, weight?: 数字 }`，最多 32 条；`src` 不收（那是来源证明，不是作者编辑的）；校验失败 INVALID_INPUT 带原因
- `pinax_worldbook_read` 的返回补 `relations`（归一成上面的形状；frontmatter 里没有就是空数组）——阅读态才有东西可显示
- 保存时把 relations 写回 frontmatter：**优先复用 `shared/worldbookFileContract.js` 的 emitter/parser**（它就是干这个的，别手写第二套 YAML 子集）；该模块不好引就照它的形状最小实现，在 limitations 里说明

**2b. 编辑面**（CarrierPaneHost `entry-detail` 编辑态，meta 三栏之下加「关系」区）：
- 行编辑：目标条目（input＋datalist，选项来自当前 entries 的名字）、类型（input，placeholder 如 师徒/敌对/亲属）、立场（input）、暗线（checkbox 隐匿关系）、删行按钮
- 「加一条关系」按钮置底
- 阅读态 meta 行下展示关系：`目标 · 类型 · 立场`，无关系不显示这块

**测试**：扩 `next/tests/carrier-worldbook.test.mjs`——meta.relations 校验（合法/超限/坏形状/src 拒收）、read 返回 relations、保存后 frontmatter 往返无损（relations 进、再读出一致、links 去重不被破坏）。

## 3. 任务三：世界书条目表格视图

IndexWindow 的 entries 树（仅 worldbook 栏）加**列表/表格**视图切换：
- 切换控件放在该栏索引窗节头（一个小按钮，icon 或「表」字，aria-label 明确），只影响 worldbook 栏，状态进 localStorage（`entriesView.<projectRoot>`，照 paneForm 先例）
- 表格列：名称／类型（kind）／关键词／字数／摘要（截 40 字）；样式沿用 prefs-grid/nx-* 词汇与 token，行点击＝打开该条目（与列表同一 openEntry）
- 数据就用现有 `data.entries`（pinax_worldbook_list 已带回），**不新增工具调用**

**测试**：shell-ui.spec——切换持久化、表格行点击打开条目、空态。

## 4. 门禁

每张工单完成后：`npm run verify:next` 五段全绿。

## 5. 边界

- **不新增任何 npm 依赖**
- **不新增 IPC 通道、不改内核**（outline tools 的 nodes 透传已够；worldbook 只动 carrier 工具面）
- **不改 outline 契约的两个文件名**（outline.json／大纲.md）；作者真稿 001-004.md 的匹配问题另行排期（导入/转换）
- 关系图的自动推导/共现建议（老版 observerrelations 那套）**不做**——只做手编辑口
- IndexWindow 其他栏（小说/资料等）不加表格视图——只 worldbook
- 新增 CSS 全走 token；执行方不 commit/push、不启停 electron
