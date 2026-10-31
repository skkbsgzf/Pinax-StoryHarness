# 批次46B 工单：标杆1 周边工具——查找替换＋快捷词取名＋导入导出＋排版偏好（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次45、46A 已收口。本批是标杆1 功能账的周边收尾，全部是「作者的手」——**不占 agent 工具面**（查找/导入走专用 IPC，不加 MCP 工具，acceptance 的 39/24 计数不许变）。

## 任务① 查找替换（全书查找＋当前章替换）

1. 主进程侧：`next/fs/fileService.mjs` 加内部方法 `searchChapters(query, { caseSensitive?, maxHits? })`——按 NNN 顺序扫 `正文/` 全部章节，返回 `{file, chapterTitle, line, snippet, matchIndex}` 列表（命中封顶 500，snippet 带上下文各 40 字）。
2. IPC：新增 `book:search`（只读）与 `book:replace-current`（带 expectedRevision 走既有保存闸，替换范围＝当前打开章，逐处替换后一次 save）两通道，合同与白名单同步。**不做全书一键替换**（破坏面大，作者逐章替换；这是有意收窄）。
3. UI：索引窗顶部查找钮（或 Ctrl+F 聚焦）→ 查找条（输入＋命中数＋上一处/下一处）→ 命中列表按章节分组，点击跳转该章并滚动定位；当前章内替换按钮＋确认。
4. 测试：searchChapters 纯逻辑（多章命中/封顶/中文）；替换走修订号闸（STALE 如实拒）；spec 查找条交互。

## 任务② 快捷词＋取名（纯派生，不落盘）

1. 新文件 `next/shell/quickWords.mjs`：照老线 `src/services/authoring/authoringQuickWords.js` 的派生逻辑移植——目录＝世界书条目 name/keys/keysSecondary ＋ 正文 n-gram 智能提取（词频≥2，滤停用词），词形 `{id, text, label, summary, sourceKind: character|setting|extracted}`；**启用项/最近项纯内存**（模块内状态），不落盘、不进偏好。
2. 取名：新文件 `next/shell/nameGenerator.mjs`——照老线 `src/services/writing/writingNameGenerator.js` 移植纯本地词库生成（批次去重），与世界书条目名查重（重名标注）。
3. UI：正文面工具条「快捷词」钮→浮层（搜索框＋分类：角色/设定/提取三组＋点击插入光标处）；浮层内「取名」tab（生成 8 个＋重名标灰＋点击插入/复制）。
4. 测试：派生目录构建（世界书 keys＋正文 n-gram 的 fixture 数据）；取名查重；spec 浮层交互与插入。

## 任务③ 导入导出（整本导出＋单篇导入并入当前书）

1. `next/shell/exportService.mjs` 扩展：`exportBook(format)`——全书章节按 NNN 顺序聚合，txt＝纯文本（章节标题分隔行），doc＝HTML 包 .doc（照既有单篇导出的 DOMPurify 清洗口径，`sanitizeFallback` 同源表）；主进程 saveDialog 照既有 `document:export` 链路。
2. 单篇导入：主进程 IPC `book:import-doc`——系统对话框选 `.txt/.md`→解析标题（首个一级标题或文件名，剥非法字符）→编号顺延生成 `正文/NNN-标题.md`（NNN 取现有最大＋1，三位零填）→fileService write 落盘（expectedRevision 0 新建轨）→返回新章节名。
3. UI 入口：索引窗「＋」旁加「导入文档」钮（或菜单「文件→导入文档到本书」），成功后刷新正文树并打开新章。
4. 测试：聚合导出的顺序与分隔；NNN 顺延与同名冲突；导入的标题解析（含无标题纯文本）；spec 入口与刷新。

## 任务④ 排版偏好补齐（段距/首行缩进/打字机/专注）

1. `next/shell/settings/WritingPrefsSection.vue` 加四项（应用级偏好，批次22 体系照旧）：段落间距 `writingParagraphSpacing`（0–2em 步进 0.1，默认 0.8）、首行缩进 `writingTextIndent`（0–2em 步进 0.5，默认 2）、打字机滚动 `writingTypewriter`（boolean，默认 false——光标保持视口约 40% 高度）、段落聚焦 `writingFocusMode`（boolean，默认 false——非当前段落降透明度）。
2. `next/shell/ipcContract.mjs` prefsSet 白名单加四字段（「带了才写」语义照旧）；`.editor-area` 消费对应 CSS 变量（`next/shell/styles/next-shell.css`，token 纪律）；打字机/聚焦为行为开关（滚动监听/类名切换），注意性能（requestAnimationFrame 节流）。
3. **novel manifest settings 本批不动**（通用渲染器与 WritingPrefsSection 的双真相源问题留给批次47 收编，本批不声明细项）。
4. 测试：偏好写读回环；spec 四控件生效（CSS 变量断言）与开关行为。

## 允许文件清单

- `next/fs/fileService.mjs`（searchChapters）、`next/shell/exportService.mjs`、`next/shell/main.mjs`、`next/shell/ipcContract.mjs`
- `next/shell/quickWords.mjs`（新）、`next/shell/nameGenerator.mjs`（新）、`next/shell/IndexWindow.vue`、`next/shell/CarrierPaneHost.vue`、`next/shell/settings/WritingPrefsSection.vue`、`next/shell/styles/next-shell.css`
- 测试：`next/tests/*.test.mjs`、`next/tests/*.spec.mjs`（acceptance/bundleAssertions 本批**不许改**——无新 MCP 工具、计数不变）

## 禁止边界

1. 不改 `server/**`、`src/**`（老线文件只读参照，逻辑重写移植不是复制文件）；不新增 npm 依赖。
2. 不加 MCP/载体工具（查找/导入是 UI 手）；book:replace-current 必须走 expectedRevision 闸，不绕修订号。
3. 快捷词/取名/启用项不落盘、不进偏好 JSON、不进 `.pinax/`。
4. 全书一键替换不做；PDF/分镜导出不做。
5. novel manifest settings 与通用渲染器不动（批次47 的事）。
6. 不启动/不杀 electron 进程；不执行 git 命令。

## 守卫标记（收尾自查＋调度方评审对照）

- 45/46A 不丢：`PLACEMENTS` 含 immersive、`EXTERNAL_WRITE_HINT`、settingsStore、AppNext 沉浸渲染、`pinax_chapter_delete`/`pinax_chapter_rename` 在 manifest tools、`CARRIER_WRITE_CLASS` 含两把新工具、toolSelect 正则含 `_delete|_rename`、审查本章钮在动作带、writingComplete 有【本书参考】段与预览口；
- 既有：IndexWindow 无「只读归档」、css 有 `.editor-area:focus-visible { outline: none`、AppNext 有 `overlayPane?.id === id`、wikiLinks 有 `buildEntryTokenMap`、formTaxonomy 词表、useBoardData 有 `AUTOSAVE_DELAY_MS`。

## 门禁要求（完成定义）

```
npm run next:build:main && npm run next:build:shell
npm run verify:next        # 五段全绿；acceptance 计数维持 39/24 不变
```

---

## §7 执行方回填（执行完成后填写）

### 交付清单
（改了什么文件、每项任务落点、新增测试清单）

### 门禁自报
（build 体积、verify:next 五段计数）

### 偏离
（与工单不一致处，逐条给理由；没写＝无偏离）

### limitations
（没做的、没验证的，如实列）

## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁；评审员对照工单读未提交 diff（基线＝46A 收口提交号）；守卫标记 grep；**acceptance/bundleAssertions 的 diff 必须为空**（本批不许动计数）。
- dameng-px 真数据端到端（全书查找、快捷词浮层、整本导出、单篇导入）由调度方接管。
- 验收结论随 46A 合并进 `docs/plan/pinax-electron-next-m2-batch46-20261031.md`（调度方写）。
