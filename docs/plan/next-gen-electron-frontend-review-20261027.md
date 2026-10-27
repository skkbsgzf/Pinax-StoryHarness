# 下一代前端：与现有代码的映射、断裂与待裁项（2026-10-27）

> 评审对象：作者口述定稿的《Pinax 下一代产品理念与架构约束（顶层文档）》。
> 本文只做两件事：拿现有代码逐条核对那份文档里的事实性断言；指出五条约束落地时会撞到什么。
> **没有开始任何实现**。所有结论都能在仓库里按 path:line 复核。

## 零、结论先行

1. 五条约束里，**约束 1（纯 Electron）与约束 4（文件夹即数据）是真断裂**，其余三条是"已有半个"或"纯新增"。好消息是地下管道已经铺好了：Electron 主进程已有原子写、单写者锁、事务表、中断恢复（`electron/projects/projectRepository.mjs:55-85`、`projectFiles.mjs:49-76`），坏消息是渲染层几乎没接——界面只用了建/开/列/关与迁移（`src/services/storage/desktopProjectRepository.js:6-20` 全仓无 `readText/writeText` 业务调用）。
2. **"23 万行前端"属实**（`src` 779 个文件、248,733 行 js/vue）。但"storage 层"不是一块可替换的积木：localStorage 被 67 个文件直接调用，`useStorage.js` 是事实入口；IndexedDB 另扛四类数据（修订史、事实账本、媒体二进制、资料长文）。重做数据层的真实工作量大致等于"改掉所有写书的地方"，不是换一个 repository。
3. **约束 2 是纯新增**：全仓没有 Electron `Menu`，也没有自绘全局菜单条。顶部现在唯一的横条是浏览器式标签带（`src/components/workbench/WorkspaceTabs.vue:214-275`）。
4. **约束 3 已有一半**：内容区里已有一条 44px 竖排图标列（`WorkspaceContentGroups.vue:148-150`，文件/搜索/书稿/扩展），但它服务的是"内容工具"，不是"载体切换"，语义要重新定义而不是复用。
5. **约束 5 部分存在但已分裂**：外壳有一套可拖宽的三区（目录 200–360、参考 320–680，`useWorkspaceHost.js:12,286`），可是 Authoring 和 ComicStudio 各自又写死了栅格（`Authoring.block-native.css:555-571` 的 `248px 1fr 52px`；`ComicStudio.vue:1221` 的 `240px 1fr 352px`）。不先抽一份分栏原语就动手，会做出第四套。
6. **最大的冲突不在前端，在文件夹布局**：文档把载体目录定成 `novel/ script/ outline/ comic/ game/ references/ worldbook/ timeline/`，而昨天刚合入的 MCP 19 工具、project-bootstrap skill、本地镜像层认的是 `正文/大纲/世界书/构思/资料/日志/约束`（`server/mcp/projectImport.js:16-31`、`server/services/localMirrorService.js:28`），作者的真稿又是第三种 kit 布局（`故事主体/卷一/第NNN章-章名/小说.md`）。三套并存意味着每加一个载体都要在"导入映射 / 索引输入集 / 提案写回"三层各写一次翻译。**这一条必须先裁，否则前端做得再对，Agent 侧全部要返工。**
7. **Agent 右栏不是"迁个 UI"**：现有唯一完整对话面是 Authoring 检查器里的一个页（`AuthoringKnowledgeAssistant.vue`，950 行），工具调用是 `<details>` 折叠、没有卡片组件、没有任务列表；而 Agent 循环跑的其实是**外部 kit 子进程**（`server/services/storyAgentRuntime.js:57`），Electron 打包白名单又把 `server/` 整个排除（`forge.config.cjs:16-21`）——**桌面版现在没有任何 Agent 后端**。要让 Agent 成为右栏一等公民，第一件事是把运行时搬进主进程，这是约束 1 的直接后果，但顶层文档里没写。

## 一、事实断言核验

| # | 文档断言 | 判定 | 证据 |
|---|---|---|---|
| 1 | 现有前端约 23 万行 | 成立（24.87 万） | `src` 779 文件 / 248,733 行 |
| 2 | 存在"浏览器存储层"需重做 | 成立，但不是一层 | `useStorage.js:134-175` 直调 localStorage；67 个文件引用 localStorage；`services/storage/storageRepository.js:4-6` 的桌面分支**零消费方** |
| 3 | `PROJECT_SURFACE_ROUTE_NAMES` 有 11 个 surface | 不成立：**10 个项目 surface + 8 个全局 surface**，其中 3 个双模式 | `workspaceTabContract.js:8-20`、`:26-35`、`:24` |
| 4 | surface 可"直接映射为载体" | 半成立 | 10 个项目 surface 里有 3 个是"设置子页"（settings/sources/map），不是内容载体；`canvas`→`prose-essay`、`entries`→`settings-worldbook-advanced` 是路由别名，语义不齐 |
| 5 | 漫画 11 个 comic 模块 | 不成立：23 文件 12,526 行（1 页 + 8 组件 + 3 composable + 10 service + css） | `src/pages/ComicStudio.vue` 1,457；`ComicPageEditor.vue` 3,825 |
| 6 | outline 域现内嵌于写作 | 成立，但数据模型已独立 | `AuthoringOutlinePanel.vue` 202、`projectOutlineRepository.js` 215、`chapterOutline.js` 149、只读视图 `OutlineStructureView.vue` 225 |
| 7 | worldHistory 域现内嵌 | 不成立：是纯服务层（7 文件 2,813 行），UI 落在地图面板，**没有独立编辑器** | `src/services/worldHistory/`；`WorldMapPanel.vue` 2,186；`CanvasTimeline.vue:3` 是分镜时间轴，不是世界史 |
| 8 | 世界书全链成熟 | 成立（规模最大） | 37 个组件 9,351 行；`WorldBookEditor.vue` 4,699 |
| 9 | materials surface 可用作"参考资料"载体 | 不成立：`/materials` 是 16 行重定向壳，真正的资料页是 `sources` | `LegacyMaterialsView.vue` 16、`SettingsSources.vue` 244、`DocumentReader.vue` 706 |
| 10 | experience / online 是两个载体 | 半成立：同一 `Experience.vue` + 同一 `gameStore`，online 只叠了房间 WS | `Experience.vue` 3,549；`services/experience/` 42 文件 10,928 行；`useOnlineRoom.js:17` |
| 11 | 剧本有部分资产（ComicStudio 脚本链） | 半成立：只有只读预览 + 漫画脚本生成，**没有剧本编辑器** | `ScriptDocumentView.vue:2`（只读）、`scriptFormat.js` 101、`comicAdaptationService.js` 471 |
| 12 | Agent 运行时后端整体保留 | 不成立（这是最容易被低估的一条） | 运行时 spawn 外部 kit 进程（`storyAgentRuntime.js:57`）；Electron 打包排除 `server/`（`forge.config.cjs:16-21`）；主进程只注册项目 IPC（`electron/main.mjs:78-86`） |
| 13 | 宿主骨架已有"三栏"可直接演进 | 半成立 | 外壳有可拖宽三区，但页面各自再写一套（见结论 5） |
| 14 | 有 Agent 插件注册点 | 不成立：只有工作台**视图**注册表（内置 4 个），Agent 能力是静态任务表 + 关键词路由 | `workspaceExtensions.js:7-58`；`agentTaskRegistry.js:37,59,85`（`registerTask` 无生产调用方）；`panelComposer.js:101-113` |

## 二、载体矩阵逐行核验

| 载体 | 现有资产规模 | 能直接搬进独立载体？ | 卡点 |
|---|---|---|---|
| 小说 | authoring surface + ProseMirror 编辑器 | 基本可以 | 数据在 localStorage（`writing_books`），要先落到文件 |
| 剧本 | 只有 235 行只读预览 + 101 行格式函数 | **不能** | 等于新写；场次/对白模型不存在 |
| 大纲 | 202 + 215 + 149 + 225 行 | 可以（缺独立页与拖拽重排） | 书级/章级两套节点模型要统一 |
| 漫画 | 23 文件 12,526 行，自成闭环，按 projectId 隔离 | 可以（资产最完整） | 页面数据在 `localStorage.comic_pages_v1`，图片在 IndexedDB `pinax-media` |
| 游戏/跑团 | 3,549 行页 + 42 文件 10,928 行服务 | 可以 | 会话走 `localStorage.writing_sessions` |
| 参考资料 | 244 + 706 + 2,206 行 | 可以 | 长文在 IndexedDB `pinax-source-archive`，元数据挂 `worldbook.sourceDocuments` |
| 世界书 | 37 组件 9,351 行，已有 `/api/localmirror` 文件同步 | 可以 | 双轨：localStorage 真源 + 目录双写，要先定谁是唯一真源 |
| 时间线 | 2,813 行服务，无 UI | **不能直接搬** | 没有编辑器，只有 `worldbook.geoHistory` 数据与地图面板里的可视化 |

## 三、五条约束的落地形态

**约束 1（纯 Electron）**：可行，但有三笔必须先结的账。一是 Agent 运行时不在包里（见结论 7）；二是 `server/index.js` 现在是 MCP 与协作的唯一宿主，搬进主进程意味着 `/mcp` 的传输层要从 Express 改成主进程内 HTTP（端口仍需回环，因为 MCP 客户端只认 URL）；三是 `npm run server` / `npm run dev` 这条 web 开发链路与纯 Electron 目标冲突，需要明确留还是砍。

**约束 2（顶部菜单）**：纯新增。技术上没有障碍，注意两点：Windows 上自绘横条要同时 `Menu.setApplicationMenu(null)` 去掉原生菜单栏，否则会上下两条；快捷键仍要注册 accelerator，否则菜单里的 `Ctrl+O` 之类失效。

**约束 3（载体竖条）**：改名与升格。现有 44px 竖条服务内容工具，载体竖条服务故事归属，两者可以并存（载体条最左、工具条次之），但必须在视觉上分开，否则用户分不清"点是换载体还是换工具"。

**约束 4（文件夹即数据）**：这是全项目最贵的一条，且与已合入的 MCP 直接冲突（见结论 6）。技术上有现成的迁移器：`electron/migration/legacyProjectImporter.mjs:87-109` 已经能把旧浏览器 bundle 写成项目目录（staging → 校验 → 整目录 rename），可以作为"老书升级"的路径，但它只覆盖文本与项目结构，IndexedDB 里的修订史、媒体二进制、资料长文要不要迁，需要单独定。

**约束 5（三栏）**：先抽原语再谈载体。建议顺序是：一份可拖宽三栏容器（列宽持久化到项目配置）→ 各载体把自己的中栏挂进去 → 最后才做 Agent 右栏。反过来的话，每做一个载体就要改一次布局，改到第三个载体时会发现前两个的列宽记忆互相打架。

## 四、六个决策点的判据

文档列的 5 个决策点，我给判断和理由，不做执行。

| # | 决策点 | 判断 | 判据与风险 |
|---|---|---|---|
| 1 | 原生 Menu / 自绘横条 | **自绘** | 顶部要承载项目名、模型状态、运行中 chip（现在这个 chip 在外壳右上角，`AppShell.vue:184-186`）；原生菜单在三个平台样式分裂且不能放状态。风险：要自己实现键盘可达性与 Alt 菜单行为 |
| 2 | 载体竖条固定还是可配置 | **可配置，默认全显** | 配置存 `.pinax/project.json` 而不是应用偏好，这样项目文件夹改名搬迁后隐藏状态跟着走。风险：新载体上线时老项目要能识别"未知载体"而不是报错 |
| 3 | 人物独立载体还是世界书内含 | **世界书内含** | 世界书 37 组件 9,351 行，`kind: character` 已是成熟分类；再抽一层会把一个已经跑通的链路拆成两个。风险：人物关系图若要做成独立编辑体验，可能要挤在世界书里加一块画布 |
| 4 | Web 版冻结还是双轨 | **冻结功能、保留服务** | 功能冻结可以，但"保留服务"必须写进文档：MCP 的 Streamable HTTP、联机协作的房间 WS 都挂在 Express 上（`server/index.js:90`、`useOnlineRoom.js:17`），删掉 Express 会连带删掉这两条已交付的能力 |
| 5 | 分屏范围 | **首期同载体** | 跨载体分屏要先解决"同一故事两个载体谁是焦点"的状态归属，属于骨架层问题；首期做会把不该耦合的状态耦死 |

## 五、必须先裁的三件事（不定这三条，任何实现都是猜）

1. **磁盘布局选哪套**。三个选项：(a) 沿用现有中文标准目录，`novel/` 等只做 UI 概念；(b) 切到文档里的英文目录，MCP 工具 + skill + 镜像层 + 迁移器一次改到底；(c) 双布局适配层（最贵，不建议）。我倾向 (a)，因为中文标准目录已经在真稿上跑通并合入主干，改它的代价是重跑全部 MCP 门禁。
2. **Agent 运行时进不进 Electron 包**。决定 `server/` 是保留还是重写为主进程模块，也决定 MCP 传输层改不改。
3. **老数据迁移口径**。localStorage 里的书、IndexedDB 里的修订史/媒体/资料长文，各自迁不迁、迁到什么程度。仓库里的迁移器只覆盖前者。

## 六、没有验证过的部分

- 打包态没实测：`forge.config.cjs` 排除 `server/` 是读配置得出的，没有真的装一次安装包来确认桌面版没有任何后端。
- "参照 DeepWrite 的本地优先模式"这条我没有读它的源码，只能算类比，不能当设计依据。
- 三栏同屏（长文档 + 漫画画布 + Agent 流）的性能没有测过。
- 各载体"能不能直接搬"的结论是看代码规模与数据归属得出的，没有实际搬迁试跑。
