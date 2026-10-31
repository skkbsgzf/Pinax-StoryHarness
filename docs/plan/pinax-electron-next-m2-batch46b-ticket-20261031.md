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

**任务① 查找替换**
- `next/fs/fileService.mjs`：`searchChapters(query,{caseSensitive,maxHits})`——按章节树顺序（卷→卷内文件→平铺章）扫 `正文/`，命中 `{file,chapterTitle,line,snippet,matchIndex}`，±40 字上下文、上限 500、`chaptersScanned` 如实记账；`replaceInCurrentChapter` 走 `service.read`＋`service.write` 与 expectedRevision 闸（STALE 原样拒），`all` 语义照旧，空替换串明确拒绝（否则等于一键清空整章）。新增 `dirRelative` 归一「正文/」前缀（章节树给的 file 路径此前会让读取拼成 `正文/正文/…`）。
- `next/shell/ipcContract.mjs`：`book:search`／`book:replace-current` 两通道（只读＋单章替换；无全书一键替换）。
- `next/shell/useBoardData.mjs`：`bookSearch` 状态、`searchBook`／`clearBookSearch`／`replaceInCurrentChapter`／`importBookDocument`／`exportBookFile` 包装；换板／清瞬时提示时收起查找结果。
- `next/shell/IndexWindow.vue`：章节区标题行查找钮＋Ctrl/Cmd+F（仅章节栏、capture 抢在浏览器查找前）；查找条含输入、命中计数、上一处／下一处、按章分组结果、点击跳转；当前章替换两步确认（第一下只换文案）、未打开章时置灰；Esc／收起钮关条并清结果。

**任务② 快捷词＋取名**
- `next/shell/quickWords.mjs`（新）：世界书 name/keys/keysSecondary/aliases＋正文 n-gram（引号词×4、英文专名×3、中文 4/3/2 字片段×1，加权 ≥2 才收，滤停用字），目录项 `{id,text,label,summary,sourceKind}`；分组/过滤/最近使用/启用项全在模块内存，关应用即失，不落盘。
- `next/shell/nameGenerator.mjs`（新）：中文／西式／日式人名（字长、性别）与地名／组织／能力／器物词池；批次内按核心名去重；世界书已有名字标 `duplicate`、不替作者换掉。
- `next/shell/CarrierPaneHost.vue`：标题行「快捷词」钮→按需弹层（两 tab：快捷词／取名）；快捷词搜索＋角色／设定／正文提取三组，点击插入光标处并收起；取名页一批 8 个、重名行摆灰且插入禁用、复制给提示或如实报失败。

**任务③ 导入导出**
- `next/shell/exportService.mjs`：`listBookChapters`／`composeBookText`／`composeBookHtml`／`exportBook`——整本按章节树顺序聚合，txt 逐章分隔线、doc 走同一清洗档；`parseDocumentTitle`／`nextChapterName`（NNN 取最大+1、撞名加 -2/-3）。
- `next/shell/bookText.mjs`（新，见「偏离」）：整本导出的纯文本口径（常量＋命名／标题函数），供渲染层安全引用。
- `next/shell/main.mjs`：`book:export` 系统 saveDialog＋`book:import-doc` 选 .txt/.md（注入文件服务写 `正文/NNN-标题.md`，expectedRevision 0）。
- `next/shell/IndexWindow.vue`：标题行「导入文档」钮与「导出整本」菜单（txt／doc）；导入成功后刷新正文树并打开新章。

**任务④ 排版偏好**
- `next/shell/settings/WritingPrefsSection.vue`：段距（0–2 步 0.1，默认 0.8）、首行缩进（0–2 步 0.5，默认 2）、打字机（默认关）、段落聚焦（默认关）。
- `next/runtime/appPreferences.mjs`：四字段归一（数值范围/步进、布尔只收布尔；`true` 不被 `Number()` 当成 1）。
- `next/shell/ipcContract.mjs`：prefsSet 白名单四字段（带了才写）。
- `next/shell/AppNext.vue`＋`next/shell/styles/next-shell.css`：根节点写 `--writing-font-size/--writing-line-height/--writing-paragraph-spacing/--writing-text-indent` 与 `dataset.writingTypewriter/writingFocus`；`.editor-area` 消费缩进与行高字号，阅读态 `.doc-reading p` 消费段距＋缩进。
- `next/shell/CarrierPaneHost.vue`：打字机滚动（隐藏镜像量 caret 纵坐标，保持在视口约 40%）、段落聚焦（上下遮罩近似），均按 rAF 节流、只在编辑事件时读一次开关。

**新增／扩展测试**
- 新：`next/tests/book-search.test.mjs`（5）、`next/tests/quick-words.test.mjs`（7）、`next/tests/index-book-tools.spec.mjs`（6）、`next/tests/writing-tools.spec.mjs`（5）。
- 扩：`next/tests/export-service.test.mjs`（逐章顺序／txt 与 doc／空书与坏目标／标题解析／NNN 顺延）、`next/tests/app-preferences.test.mjs`（四字段范围/步进/布尔/写读回环/patch）、`next/tests/shell-ui.spec.mjs`（四控件＋CSS 变量＋dataset）。

### 门禁自报

- `npm run next:build:main && npm run next:build:shell`：通过。主进程 1738.5 kB、外壳 1986.9 kB、preload 4.9 kB、渲染层 1053.9 kB（bundleAssertions 记账）。
- `npm run verify:next`：五段全绿。
  - acceptance：M1 空框架＋M2 真载体验收 **20/20**，工具面 **39 / 24**（维持不变）。
  - `node --test next/tests/*.test.mjs`：**548 通过 / 0 失败**。
  - `vitest next`：**12 文件 / 179 测试全过**。
  - `eslint next --max-warnings 0`：0 警告。
  - bundleAssertions：构建参数、裸导入白名单、无 Express、产物可执行、渲染层薄、技能与载体资产等全部通过（含新增 `f` 渲染层 1053.9 kB）。
- acceptance.mjs／bundleAssertions.mjs 本批未改动。

### 偏离

1. `next/shell/useBoardData.mjs`（未在允许清单）：查找/替换/导入/导出必须经数据层落到 IPC 与章节树状态，否则 UI 无法接线；只加状态与薄包装，未改既有保存/修订号语义。
2. `next/runtime/appPreferences.mjs`（未在清单）：任务④要求四字段写读回环与校验，偏好归一必须在此处加白名单/范围，否则 prefsSet 白名单会丢字段。
3. `next/shell/AppNext.vue`（未在清单）：任务④要求「`.editor-area` 消费 CSS 变量」与行为开关；变量与 dataset 写在根节点（应用级），只增四变量与两 dataset，不动沉浸渲染与既有主题逻辑。
4. `next/shell/bookText.mjs`（新、未在清单）：`ipcContract`（渲染层也加载）需要 `BOOK_DIR` 等纯常量；从 `exportService` 直接引会把 `node:fs/node:path` 带进渲染层 bundle（bundleAssertions 首轮实际报 `isAbsolute` 缺失）。纯函数拆出后 `exportService` 重新导出，既有测试与调用方不变。
5. 查找跳转是「打开命中章」，不滚动到命中行（textarea 无按行滚动接口，见 limitations）；命中列表的每行 `title` 给出文件与行号。
6. 导入入口放在章节区标题行（导入／导出／新建三枚图标钮并列），并非严格「＋旁」；交互等价。
7. 空替换串被拒绝：工单未写，但放行等于一键清空当前章，与「逐处手动删改」的收窄相冲突。

### limitations

- 正文编辑区是 `<textarea>`，无法逐段排版：段距只作用于阅读态 `.doc-reading p`；编辑态只消费首行缩进（整块缩进）与字号/行高。
- 段落聚焦用上下两层遮罩近似「非当前段落压暗」，不是真正的逐段透明度；textarea 拿不到段落 DOM，只能到这一档。
- 打字机滚动靠隐藏镜像测 caret 纵坐标，测试在 jsdom 里用桩测高度验证滚动目标；真实字体/换行下的精度未做端到端实机验证。
- 全书查找只扫 `正文/`、纯子串（无正则）、上限 500，超出记 `truncated`；大小写开关默认不敏感。
- 导入只支持系统对话框选单个 `.txt/.md`，不做文件夹批量导入；导入正文原样落盘，不做 md 渲染或章节切分。
- 整本 doc 导出按纯文本转义＋`<br>` 生成（主进程不引 md 渲染器），不是带标题层级的富文本；与单篇导出共用清洗档。
- 复制名字在无剪贴板权限的环境会显示「复制失败，请手动选中」，不假装成功（自动化测试用桩验证成功路径）。
- 未做 dameng-px 真数据端到端（工单划归调度方）。


## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁；评审员对照工单读未提交 diff（基线＝46A 收口提交号）；守卫标记 grep；**acceptance/bundleAssertions 的 diff 必须为空**（本批不许动计数）。
- dameng-px 真数据端到端（全书查找、快捷词浮层、整本导出、单篇导入）由调度方接管。
- 验收结论随 46A 合并进 `docs/plan/pinax-electron-next-m2-batch46-20261031.md`（调度方写）。
