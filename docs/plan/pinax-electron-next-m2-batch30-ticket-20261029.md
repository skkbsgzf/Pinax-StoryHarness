# 批次30 执行工单：大纲真稿导入转换——散文章节稿 → outline.json（2026-10-29）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash），经 workflow 编排派发
> 调度方：Zcode（验收、门禁、提交）
> 作者指令：把大纲与剩下的未做项继续往下做。作者真稿是大梦的 `大纲/001-004.md`——
> 散文章节稿，现契约只认 `outline.json`／`大纲.md` 两个名字，编辑器对真稿报「既没有」。

## 0. 现状锚点（先读这些再动手）

- **真稿格式**（`D:/Projects/大梦/大纲/001-004.md`，137 行）：`# 卷一开篇 · 小说大纲（第一章至首战）` 文件题，`## 第一章《牛肉汤》` `## 第二章《延迟》` … 章节节，节内有 `### 章功能／简纲／STAR／登记` 小节。**一份文件可以含多章**；文件名 `001-004.md` 是章节号区间，不是标题。
- `next/runtime/projectImportAdapter.mjs`：E1 整目录导入——`IMPORT_CATEGORY_BY_DIR` 已认「大纲」类别，拷进项目大纲/ 目录（只新增不覆盖），**但不做转换**；编辑器仍读不了。
- `next/carriers/outline/tools.mjs`：`pinax_outline_read` 只认 `outline.json`（结构化）与 `大纲.md`（散文原文＋warning）；`pinax_outline_save` 整份覆盖 nodes+edges。
- 批次28 起 outline 节点支持 `note` 字段（nodes 透传，编辑面有备注框，maxlength 200）。
- `next/shell/settings/ImportSection.vue`＋通道 `pinax:agent:project:import-run`：E1 导入的 UI 与接线先例（服务未接如实报缺、结果逐条摊开）。
- M2.5-C：`subscriptions: ['project.changed']` 只是声明，**宿主没有发布者**——导入完成后 UI 刷新走既有 `notifyProjectOpened`（E1 同款），不做事件总线。

## 1. 任务一：散文大纲解析器

新建 `next/runtime/outlineProse.mjs`（纯函数，无 IO）：

```js
// 输入一份 md 文本＋相对路径，输出章节节点草稿
parseOutlineProse(text, relativePath) → {
  docTitle,          // 首个 `# ` 行（没有则 null）
  chapters: [{
    title,           // `## ` 标题行原文（去 # 与空白；空标题跳过并记 warning）
    note,            // 该节正文 strip 掉 md 标记后的前 200 字（200 字处截断加「…」）——
                     //   strip = 去 #/标题行/加粗星号/列表符号，保留纯文本行
    source,          // `${relativePath}#${title}`——幂等去重与溯源的键
  }],
  warnings: []
}
```

- 小节（`### …`）不立节点：`### 简纲` 的编号清单是章内容的一部分，进 note；不为它编造层级（诚实边界：真稿的层级在标题里只有两层）。
- 没有 `## ` 标题的 md（整篇散文）→ 0 章＋warning「该文件没有章节标题」，不猜。

## 2. 任务二：导入服务（只新增不覆盖，源文件零改动）

新建 `next/runtime/outlineImportService.mjs`：

```js
importOutlineChapters({ root, fileService }) → {
  // 1. fileService.list 大纲/ 下全部 .md（含 大纲.md；不含 outline.json）——文件名升序
  // 2. 逐份 parseOutlineProse
  // 3. pinax_outline_read 同源逻辑读现有 outline.json（没有→nodes=[]，revision=0）
  // 4. 合并：已存在节点里 source 相同的 → 跳过（reused）；source 不在现有节点里的 → 追加
  //    **现有节点一律不动**（作者改过的备注/标题/排序不覆盖）；追加节点 id 用 `imp-<递增>`
  //    且不与现有 id 冲突；edges 一律不新增（章节顺序 = nodes 数组序，不造连线）
  // 5. 追加数为 0 → ok:{ imported:0, reused:N }（幂等重跑不报错）
  // 6. 写盘走 fileService write（outline.json，expectedRevision=读到的 revision；
  //    冲突 STALE_REVISION 原样上抛，不重试不覆盖）
  // 7. 源 md 一个字节不动；目录里没有任何 .md → INVALID_INPUT「大纲/ 下没有可转换的 md」
}
```

- 这个口**只对当前项目的 大纲/ 操作**，不吃外部源路径（外部导入是 E1 的活，先 E1 拷进来再转换）。

## 3. 任务三：IPC＋设置页入口

- 通道 `pinax:agent:outline:import`（ipcContract＋index.mjs 接线，照 import-run 先例：服务未接如实报缺）。
- `next/shell/settings/OutlineImportSection.vue`（新，注册进 settingsSections，「文档」组，id `outline-import`，标题「大纲转换」，keywords 含 大纲/章节稿/outline/001-004）：显示扫描结果（N 份 md · M 个章节标题）→「转换并导入」→ 结果逐条（导入 X 章 / 复用 Y 章 / 冲突如实报）；成功后走既有项目刷新路径让左树立刻长出节点。
- `IndexWindow.vue` 大纲空态那句提示补一句指引：「大纲目录里有章节稿（md）时，可在 设置 → 大纲转换 一键生成节点」（纯文案，不加按钮——U13）。

## 4. 测试

`next/tests/outline-import.test.mjs`（新）：
- parse：大梦格式夹具（# 文件题＋两章 ##＋### 小节＋加粗/列表）→ 2 章、note ≤200、source 正确；无 ## 文件 → 0 章＋warning
- import：空目录报缺；首次导入全量 append；重跑幂等（imported:0, reused:N）；作者已改某节点标题/备注后重跑 → 该节点不被覆盖、新章节照常追加；revision 冲突原样 STALE_REVISION；源 md 字节不变（前后 read 对比）

shell-ui.spec：转换节挂载→假桥返回→结果渲染；空态指引文案在场。

## 5. 门禁

`npm run verify:next` 五段全绿（M2.5 后基线：内核 387、界面 101、打包 a–l）。

## 6. 边界

- **不新增 npm 依赖**；**不改 server/**、src/**；不新增 npm 依赖
- **不改 outline 工具合同**（outline.json／大纲.md 两名不动——本批是把 md 转成 outline.json，不是教工具读 md）；不动 pinax_outline_save 语义
- 源 md 永远只读；P17（原始映射不动）不许破
- 不做：### 小节立节点/建层级、事件总线（M2.5-C 记账在案）、节点跳回源文（source 已存，跳转后续批）
- 新增 CSS 全走 token；执行方不 commit/push、不启停 electron
