# 老前端功能规格盘点（迁 Next 用，2026-10-28）

> 目的：回答「把原有功能通过插件模块化放回 Next」时，**到底有哪些功能、各在哪、多大、数据归谁、迁到哪个载体**。
> 方法与边界：以用户手册 10 篇（docs/user-manual/01–10）、`src/router/index.js` 路由表、
> `src/services/workspace/workspaceTabContract.js` 的 surface 合同、
> [next-gen-electron-frontend-review-20261027.md](./next-gen-electron-frontend-review-20261027.md) 的逐条取证为底，
> 按域归纳功能点。**没有逐行读完 10 万行前端**——功能清单以手册与组件名为准，规模数字沿用上轮实测。
> 配套的迁移规则与排序见 [ui-consistency-plan](./pinax-electron-next-ui-consistency-plan-20261028.md)。

## 0. 结论先行

1. 老前端共 **8 个功能域 + 4 项横切能力**，对应 10 个项目 surface + 8 个全局 surface（`workspaceTabContract.js`），路由表 17 条扁平子路由。
2. 按 Next 的两级模型映射后：**2 个域已在 Next（小说、设定，M2 批次1–6）**；**3 个域可整体搬迁**（资料、漫画、体验）；**2 个域要新写**（剧本、独立大纲——老前端本来就没有编辑器）；**1 个域拆散迁**（设置页拆进外壳偏好/项目配置/模型面）。
3. 手册口径的功能点合计约 **55 项**；其中正文链（章节/批注/推演/助手）约占一半，是 M2 之后的第一个"深水区"——已迁的只是章节 CRUD + 编辑 + 提问，**批注/局部改写/推演链/插图/速记都还没进 Next**。
4. 最大的非 UI 前置依赖只有一个：**R3 老数据迁移未裁**（localStorage 67 文件、IndexedDB 修订史/媒体/资料长文）。手册里每个域的功能都默认数据在浏览器侧；走文件轨的作者不受影响。

## 1. 总表：域 → Next 载体映射

| 域（手册） | 老资产规模（上轮实测） | 数据真源 | Next 载体 / capability | 状态 |
|---|---|---|---|---|
| 写作（05-writing + authoring） | authoring surface + ProseMirror；助手面板 950 行 | `正文/`（文件轨）或 `writing_books`（浏览器轨） | `pinax.novel` · `text.chapters` | **部分已迁**（M2 批次1–6：章节 CRUD＋编辑＋右栏提问） |
| 世界书（03-worldbook） | 37 组件 / 9,351 行（WorldBookEditor 4,699） | `世界书/` 双轨（localStorage 真源 + 目录双写） | `pinax.setting` · `setting.entries` | **已迁最小面**（条目列表＋阅读）；编辑器/关系图/导入未迁 |
| 资料（04-materials + sources） | 244 + 706 + 2,206 行 | IndexedDB `pinax-source-archive` + `资料/` | 新载体 `pinax.reference` · `reference.documents` | 未迁（M3） |
| 分镜/视频（06-storyboard） | 与漫画同域 23 文件 12,526 行内 | `localStorage.comic_pages_v1` + IndexedDB `pinax-media` | `pinax.storyboard` · `storyboard.shots` / `video.render` | 未迁（M4） |
| 漫画（09-comics） | 同上；ComicPageEditor 3,825 行 | 同上 | `pinax.comics` · `media.assets` | 未迁（M4） |
| 体验/跑团（02-experience） | 页 3,549 + 服务 42 文件 10,928 行 | `localStorage.writing_sessions` | `pinax.experience` · `session.runs`；联机为外部服务 | 未迁（M5） |
| 剧本/大纲（无手册章） | 剧本只读 235 行；大纲 202+215+149+225 行 | `大纲/outline.json` | 新写 `pinax.script`（`script.scenes`）＋大纲进 novel 或独立 | **新写**（M6） |
| 设置（07-settings） | SettingsSources 244 行等散页 | 应用偏好 + `.pinax/project.json` | 外壳「设置」菜单 + 模型面 | **拆散迁**（模型面是当前死菜单，下一批优先） |

横切能力：助手/模型选择（advisor + 运行包）、主题（app_theme，Next 已共享同一 localStorage 键）、i18n（`src/i18n/`，Next 暂无）、备份/恢复（手册 07；文件轨下由 `.pinax/` + 目录备份承接）。

## 2. 分域功能清单

### 2.1 写作（authoring / writing）——体量最大、迁移最深
手册功能点：章节、构思和速记；正文编辑和排版；**批注和局部改写**；助手；生成插图；**推演：续写或先试情节**；当前（人物、地点与时间）；助手工作时继续发消息。
- 已进 Next：章节新建/列表/打开（IndexWindow + CarrierPaneHost 编辑器）、保存为新版本（fileService 乐观并发）、右栏结构化审稿对话（AssistantDialog）。
- 未进 Next（按依赖顺序）：ProseMirror 富排版（当前是纯 textarea）→ 批注/局部改写（依赖提案链 UI）→ 推演链（依赖 agent 任务面 + 会话保持）→ 生成插图（依赖媒体轨）→ 速记/构思（`notes.ideas` capability 已在词表，无 UI）。
- 一致性风险：ProseMirror 的工具条控件必须进 `.control-*` 词汇；编辑区字号走 `--nx-fs-lg`（15px，与老版写作面一致）。

### 2.2 世界书（setting）
手册功能点：打开本书设定；新建与编写；右侧工具（同类/场景经历/表格/关系/管理）；底栏正文提及与插入；导入参考资料；资料列表、项目文档和知识检索；从资料到正式设定。
- 已进 Next：条目列表（契约档案/未建档区分）、条目阅读（frontmatter 正文）、字数与版本显示。
- 未进：条目编辑器（4,699 行的主体）、关系图、表格视图、底栏插入、导入浮窗、知识检索面板（检索后端已由 MCP `pinax_knowledge_search` 打通，缺的是 UI）。
- 数据注意：双轨并存——迁编辑器前必须先裁「谁是唯一真源」（复盘 §三.9 的 13 组同名条目同样悬着）。

### 2.3 资料（materials / sources）
手册功能点：从正文收一段；插画与漫画。
- 现状：`/materials` 是 16 行重定向壳，真身是 `sources`（SettingsSources 244 + DocumentReader 706）。
- 迁移形态：独立只读为主的载体；长文在 IndexedDB，**R3 裁决前只能先做文件轨资料**（`资料/` 目录 + `reference.documents`）。

### 2.4 分镜 / 视频（storyboard）
手册功能点：从一段故事开始；节点整理成镜头顺序；编导顾问和生图；生成视频；导出。
- 依赖本地图片与 ComfyUI 出片链路（spec §8 M4 注：必须晚于合同稳定）；媒体二进制在 IndexedDB `pinax-media`。

### 2.5 漫画（comics）
手册功能点：开始方式；页面计划；页目录；从候选走到成稿；编辑与保存；生成请求的可靠性；视觉圣经；构图。
- 23 文件自成闭环、按 projectId 隔离，是"能整体搬"的典型；但数据全在浏览器侧，**是 R3 的最大单一债**。

### 2.6 体验 / 跑团（experience）
手册功能点：从本地演示开始；选择本场玩法；写一条行动；场景冒险与主持；会话、记录与素材；联机；与写作工作台的区别。
- 依赖 `script.scenes` 能力（spec D4 的闭环案例）；联机房间 WS 挂在 Express——按外部服务插件处理，不进内核。

### 2.7 剧本 / 大纲
- 老前端**没有**剧本编辑器（235 行只读预览）和独立大纲页；这两块在 Next 是新写，不是迁移（spec §8 M6 已裁）。

### 2.8 设置
手册功能点：界面与助手语言；写作；外观；记忆与历史；模型；体验；备份与恢复；本地项目。
- Next 已有：明暗切换（菜单 + 竖条按钮，与老前端共享 `app_theme`）、界面缩放（0.85 默认，env 可覆写）。
- 缺口按优先级：**模型配置面（`设置 → 偏好与模型…` 死菜单，下一批①）** → 偏好持久化（缩放/首屏板）→ 语言 → 备份。

## 3. 横切的一致性事实（迁每个域都会撞到）

1. 老前端的字号只在 `--fs-sm(12)/--fs-base(14)` 两档有 token，其余（11/13/15/17/19/21px）全是裸 px——**Next 已于批次 7 收进 `--nx-fs-*` 刻度并上门禁**；搬老组件时照旧走 `legacy-copied` 豁免或收编刻度。
2. 圆角老前端三档（control 10 / popover 16 / surface 24）+ 散装 6/12/18/20px；Next 刻度见规范 v1 §3。
3. 助手面板是唯一被两个域共用的完整对话面——Next 已把它抽成 `AssistantDialog.vue`；后续任何域的"助手"入口都应复用它，不再各写一套。
4. MCP 19 工具与载体 `tools` 的一对一映射（spec §12 未核项）在 M3 动世界书编辑器时必须先核，否则编辑器保存链会绕开提案口径。

## 4. 迁移状态汇总（截至本档）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 空框架（内核/文件服务/运行时/外壳/项目合同/verify 链） | ✅ 2026-10-27 |
| M2 批次1–6 | 小说＋设定最小面、真模型链路、右栏纯对话框、UI 刻度收口 | ✅ 2026-10-28（批次7 本档同日） |
| M2.5（建议新增） | 模型配置面 + R3 裁决 + 作者真实回合（DoD #8） | 未开工，**优先于 M3** |
| M3 | 世界书编辑器 + 资料 | 未开工 |
| M4 | 漫画 / 分镜 / 视频 | 未开工（前置：合同稳定判据） |
| M5 | 体验 / 联机 | 未开工 |
| M6 | 剧本 / 大纲（新写） | 未开工 |
