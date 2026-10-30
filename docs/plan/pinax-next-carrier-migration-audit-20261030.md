# Pinax.Next 载体迁移盘点（2026-10-30）

> 口径：只认 `next/` 里的现状源码；老版 `src/` 与 `server/**` 是搬迁来源，不改。行数只用来量规模，**不是完成度百分比**。本盘点只读源码，没有起 Electron，也没有跑真机。

## 结论

1. **正文的续写与提示没有迁移。** Next 的正文编辑面是一个 `<textarea>`（`next/shell/CarrierPaneHost.vue:365-371`），保存是作者按 Ctrl+S（同文件 `:251-258`）。老版那套 ProseMirror 块编辑器、AI 命令菜单（推演下一段／改写／扩写／精简／审查本章）、行内联想（Tab 全采纳／Ctrl+→ 采纳一句／Esc 忽略）、自动联想开关、续写参考、提示词预览、快捷词、取名、自动保存——全部留在 `src/`，Next 里没有对应实现。
2. **七个已登记载体都只到「目录＋列表／读／写＋最简面板」。** 没有一个是整页／整工作区搬完的；世界书、大纲、构思、剧本尤其明显，老版对应的是 4,699 行、202 行、255 行、235 行的专门界面。
3. **规范里还有两组载体零实现。** M4 素材／漫画／视频、M5 体验／联机，在 `next/carriers/` 里没有目录、没有清单、没有界面。
4. **规模账。** Next 非测试源码 27,247 行（mjs／vue／css／js），其中外壳 14,918、载体 3,207；老版与载体直接相关的 UI 目录合计 47,955 行；M4 规范口径 12,526 行、M5 规范口径 10,928 行（`docs/plan/pinax-electron-next-spec-20261027.md:182-183`）。

## 一、正文专项：老版有什么，Next 有什么

| 能力 | 老版证据 | Next 现状 |
| --- | --- | --- |
| AI 命令菜单：推演下一段／改写／扩写／精简／审查本章／插入结构 | `src/components/writing/WritingNotebookEditor.vue:251-268` | 无 |
| 行内联想与键位（Tab 全采纳、Ctrl/Command+→ 采纳一句、Esc 忽略） | `WritingNotebookEditor.vue:553-554` | 无 |
| 自动联想开关 | `src/pages/Authoring.vue:64` | 无 |
| 续写意图与提示词（continue／advance／simulate／insert／rewrite 等） | `Authoring.vue:4660-4668`，任务映射 `server/services/openclawService.js:14、35-43` | Next 外壳与运行时零引用；`grep writing.continue` 只命中 `server/`、`shared/` 与 `.build` 产物 |
| 续写参考（把素材／速记带进续写） | `Authoring.vue:1440、3391-3399` | 无 |
| 提示词预览（块标签＋预算） | `src/components/agent/PromptPreviewPanel.vue`（383 行） | 无 |
| 快捷词／取名 | `src/components/authoring/AuthoringQuickWords.vue`（70 行） | 无 |
| 块编辑器（ProseMirror） | `Authoring.vue` 10,892 行＋`WritingNotebookEditor.vue` 4,034 行 | 纯 textarea |
| 自动保存 | `Authoring.vue:8584` 起（自动保存只负责落盘） | 只有 Ctrl+S 手动保存与保存 chip（`CarrierPaneHost.vue:31-38`） |
| 排版偏好：段距／首行缩进／块边界／打字机／专注 | `src/components/workbench/WritingPreferences.vue`（34 行） | 只有字号 14–22、行高 1.6–2.4（`next/shell/settings/WritingPrefsSection.vue:1-40`） |
| 校对／查找／双栏／生图／继续创作指引／导出整本／导出章节分镜／导入 TXT·Markdown／素材收件箱／回到冒险 | `Authoring.vue:45-75` 的更多菜单 | 无；Next 导出只导「当前打开的那一份文档」（`next/shell/AppNext.vue:192-215`），导入只有整目录导入（`next/shell/settings/ImportSection.vue`） |

**容易被误认成「已迁移」的两处：**

- 右栏四条 `/审阅`、`/大纲`、`/总结`、`/资料` 是**聊天提示模板**（`next/shell/slashCommands.mjs:17-42`），发送给运行时问答；它们不往正文光标处写续写，也不是行内联想。
- 提案审阅／采纳（`CarrierPaneHost.vue:451-489`、`next/shell/useBoardData.mjs` 的采纳流程）是**整章级**的 AI 改稿写回，能当作「AI 辅助写作」的粗轨道，但它不是老版那种光标处续写、逐句采纳。

## 二、七个载体逐项对照

### 1. 小说／正文（`pinax.carrier.novel`，525 行）

- **有**：卷→章两级目录与排序、`pinax_chapter_list/read/save`、修订号并发校验、提案 `list/read/discard` 与采纳、文档历史、单篇导出、备份恢复。
- **没有**：第一节列出的整片 AI 写作能力；章节删除／重命名／移动（文件服务没有对应 API，`next/fs/fileService.mjs:459` 只有 `revisions.delete`）；整本导出；单篇 TXT/MD 导入；自动保存；块编辑器；细项排版偏好。
- **证据**：`next/carriers/novel/tools.mjs` 全文只做章节 CRUD 与提案；`next/carriers/novel/manifest.mjs` 的工具面六把，无一触及写作辅助。

### 2. 世界书（`pinax.carrier.worldbook`，856 行）

- **有**：`list/read/save`、一层类别目录、`meta` 口（keys／tags／summary／relations）、条目阅读态的 Wiki 双链与反向链接（批次38）。
- **没有**：老版 `EntryWiki.vue`（270 行）的头部件——状态徽章（draft/active/retired）、类别、类型、注入组、lede、全文展开、未解析引用提示；`EntryProfileEditor.vue`（451 行）的模板选择、必填／自定义字段、口吻档案（说话风格、常用／禁用词、示例台词、问候语）、投影预览、冲突对话框；`EntryMdEditor.vue`（228 行）的 `[[词条引用]]` 预览高亮；世界书编辑工作区（`WorldBookEditor.vue` 4,699 行＋`WorldbookCreationWorkspace.vue` 2,206 行）的多世界书、研究、生成、批量操作；条目删除／重命名。
- **证据**：`next/shell/CarrierPaneHost.vue:4、82-84、145、327-340` 只覆盖链接化、反向链接与 meta 折叠面板；`next/carriers/worldbook/tools.mjs:1-52` 的注释明确只做正文＋四类 meta。

### 3. 约束／设定（`pinax.carrier.setting`，304 行）

- **有**：`pinax_rule_list/save`，`约束/` 下的 md 列表与编辑。
- **没有**：老版没有独立的「约束」竖条格（老版竖条是文件／搜索／书稿／扩展，`src/components/workbench/WorkspaceContentGroups.vue:23`），约束散在结构化设置与设定工作区；Next 把它立成独立板，但目前只有最小编辑面，没有设定字段、模板、投影与冲突那套。
- **说明**：这一栏是「新立的最小面」，不是「搬了一半的老页面」。

### 4. 资料（`pinax.carrier.reference`，440 行）

- **有**：`.md`／`.txt` 的 `list/read/save`、`pinax_reference_search`（进程内 `knowledgeService`，工单 H2）。
- **没有**：资料导入／上传／来源管理（老版 `SettingsSources.vue` 244 行＋`WorkspaceSourcesView`）、知识库索引状态与同步 UI、PDF／网页抓取、资料删除／重命名；HTTP 轨（`pinax_knowledge_search`／`pinax_project_index`）仍未接 Next UI。
- **证据**：`next/carriers/reference/manifest.mjs` 工具面四把；`next/runtime/knowledgeService.mjs` 只包进程内检索；批次19 账里已记「无索引状态／同步 UI」。

### 5. 大纲（`pinax.carrier.outline`，275 行）

- **有**：`nodes + edges` 整份读写、大纲树、悬浮小工具窗、增同级／增子级／移动／删除、节点标题与备注、大纲导入（`OutlineImportSection.vue`）。
- **没有**：老版 `AuthoringOutlinePanel.vue`（202 行）的**总纲／章纲两层**（`:147-159`）、`chapterRefs` 关联章节、`explorationRefs` 推演草稿、引用失效提示、搜索／筛选／提取／插入正文（`:154、167-169`）、冲突检测、边关系编辑；Next 的 edges 只有层级 from→to，没有老版那套关系语义。
- **证据**：`next/carriers/outline/tools.mjs:12、55-71、100-126`；`next/shell/useBoardData.mjs` 的大纲段只做增删移与整份保存。

### 6. 构思（`pinax.carrier.notes`，203 行）

- **有**：`构思/` 下 md 的 `list/save`、编辑面。
- **没有**：老版 `AuthoringIdeaShelf.vue`（255 行）的推演夹、搜索、分组、归档、旧速记迁移（`:10、16、27、42-43、92-94`）、与正文／大纲的引用连接；老版 `Notes.vue`（1,556 行）其实是**素材页**（素材分类、送画布、合并、采纳、归档、删除），和 Next 的 `notes`（构思速记）不是同一个东西——这一条容易在盘点时混名。
- **证据**：`next/carriers/notes/manifest.mjs`；`next/shell/CarrierPaneHost.vue:378-400` 的构思编辑面只有 textarea。

### 7. 剧本（`pinax.carrier.script`，397 行）

- **有**：`剧本/` 下 `.md` 的 `list/read/save`、单篇导出、上下文素材块。
- **没有**：老版 `ScriptDocumentView.vue`（235 行）的结构化剧本渲染——场景头、动作、对白、钩子、旁白、拆解字段与徽章；场景级编辑；剧本历史未纳入（`next/history/gitHistory.mjs:44` 的白名单只有正文／大纲／世界书／构思／约束／资料，没有「剧本」）。
- **证据**：`next/carriers/script/tools.mjs:1-16` 明确「只认 .md，不做分镜表」；`next/shell/CarrierPaneHost.vue:758` 附近用通用 md 渲染。

## 三、还没开工的载体

| 里程碑 | 载体 | 老版体量（规范口径） | Next 现状 |
| --- | --- | --- | --- |
| M4 | 素材／漫画／视频 | comics 23 文件／12,526 行 | 零：`next/carriers/` 无目录、无清单、无界面；素材页老版 `src/pages/Notes.vue` 1,556 行也未搬 |
| M5 | 体验／联机 | experience 单页 3,549 行＋42 服务／10,928 行 | 零：无 carrier、无 IPC、无界面；规范 D4 的「体验 requires script.scenes」依赖闭环目前没有可校验的对象 |

规范出处：`docs/plan/pinax-electron-next-spec-20261027.md:182-184`。M4/M5 的依赖（本地图片、ComfyUI 出片、外部联机服务）也都不在 Next 里。

## 四、跨载体的共性缺口

1. **文件服务没有删除／重命名／移动。** `next/fs/fileService.mjs:459` 的 `revisions.delete` 只清修订状态，不删文件；因此七个载体都只能在界面里新建和覆盖，不能删章、给条目改名、移动文件。
2. **没有自动保存。** 正文、速记、约束、资料、剧本、条目、大纲全部靠 Ctrl+S；老版正文有自动保存链路（`Authoring.vue:8584`）。
3. **编辑器只有 textarea。** 没有块级编辑、行内标记、`[[引用]]` 预览、富文本粘贴；世界书阅读态有 Wiki 链接，但编辑态仍是纯文本。
4. **导入／导出口径窄。** 导入只有「整目录导入成新项目」（`ImportSection.vue`），不能把一篇 TXT/MD 加进当前项目；导出只有当前打开的那一份（`AppNext.vue:192-215`），没有整本、分卷、分镜导出。
5. **历史覆盖不全。** 剧本不在历史白名单（`gitHistory.mjs:44`）；提案目录在（`:49`），但载体自有元数据（如世界书 proposal 状态）是否全部留痕，未逐项验。
6. **载体设置几乎为空。** 只有小说声明了 `novel.writing`，且内容只有字号／行高；其余载体 `settings: []`。老版写作偏好里的段距、缩进、块边界、打字机、专注都没有落点。

## 五、建议的搬迁顺序（待作者裁定，不自动开工）

按「作者每天真正会用的手」排序，而不是按代码量：

1. **正文续写／提示最小闭环**：先在现有 textarea 上接「续写／改写／扩写／精简／审查本章」五个动作，走运行时＋提案轨，结果进提案审阅；不做 ProseMirror，先补能力缺口。
2. **自动保存＋章节删除／重命名**：文件服务补受控的 delete／rename，接进索引窗右键菜单；自动保存走防抖＋修订号。
3. **世界书阅读／建档面**：EntryWiki 头部（状态／类别／类型／注入组／lede）、口吻档案、`[[引用]]` 预览。
4. **大纲两层与引用**：总纲／章纲、chapterRefs／explorationRefs、插入正文。
5. **剧本结构化渲染＋历史白名单**：把 `ScriptDocumentView` 的字段与徽章搬成 Next 视图，剧本纳入历史。
6. **M4／M5**：按规范后置，先把素材页与出片链路单独立工单。

## 六、本次盘点的边界

- 只做了源码静态核对，没有启动 Electron／服务，没有跑 `verify:next`；文中「有／没有」均指源码里能否找到实现与接线，不代表真机行为已验收。
- 行数是 `wc -l` 的粗计，含注释与样式；M4／M5 数字沿用规范里的统计口径，没有重新逐文件复核。
- 老版「续写」的提示词仍躺在 `server/services/openclawService.js` 与 `shared/agentCapabilityContract.js`，它们是只读来源，不代表 Next 已接。
