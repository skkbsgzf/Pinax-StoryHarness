# 批次12 工单（执行方：Qoder · DS V4 Flash）（2026-10-28）

> **分工裁定（作者 2026-10-28）**：从本批起，执行层改由 Qoder 侧 DS V4 Flash 承担；
> Zcode 会话负责调研、工单撰写、验收、门禁复核与 git 提交。工单通过本文档交接。
> 本批工单基于批次10–11 后的代码现状调研撰写（工单里给了每个要点的出处文件）。
> **认领方式**：开工前在本文件 §4 认领表填会话名与时间；完成后把结果填进 §5，
> 并按仓库惯例更新 `docs/STATUS.md` 与批次记录（批次12 命名沿用：`pinax-electron-next-m2-batch12-*.md`）。
> **提交**：与批次9 先例一致，执行方不 commit/push——验收与提交由 Zcode 会话统一做。

## 0. 全局纪律（每张工单都适用）

1. 门禁：`npm run verify:next` 五段必须全绿（验收 16＋内核单测＋外壳界面测＋eslint 0 警＋打包 a–k）。
2. 视觉规则：颜色一律 token（src/styles/ legacy CSS 词汇）；Next 自写样式禁裸 px 字号/圆角（用 `--fs-*`/`--radius-*`/`--nx-fs-*`）；按钮必须落在 `.control-*`/`.nx-row`/`.workspace-nav-item`/`.nx-ribbon-item` 词汇；jsdom 无 `matchMedia`（照既有 typeof guard）。
3. 文件所有权：只改工单点名的文件；**不要动 `next/shell/styles/next-shell.css` 的 860px media query 区（批次9 窄屏线的领地）**；不碰 server/、src/、docs/、electron/（工单 B3 的文档除外）。
4. 与并行会话（Zcode）的碰撞预防：Zcode 当前只在验收/提交时工作；若你发现工作副本有超出本工单的未提交改动，先在 STATUS 记账再动手，不要回滚别人的 WIP。
5. electron 进程：启动验收窗口前先按命令行过滤（只清命令行带本仓 `node_modules/electron` 的实例），不要全杀。

## 1. 工单 B1：构思/速记（notes.ideas 的最小可用面）

- **依据**：novel 载体 `dataDirs.notes = '构思'` 且 scopes 已有 `file:构思:rw`（`next/carriers/novel/manifest.mjs`），但工具面与 UI 完全没有入口；老前端写作手册功能点「章节、构思和速记」（docs/user-manual/05-writing.md §章节、构思和速记）。
- **任务**：
  1. `next/carriers/novel/tools.mjs`：照 `pinax_chapter_list`/`pinax_chapter_save` 的完整先例新增 `pinax_notes_list`（列 `构思/` 下 .md）与 `pinax_notes_save`（写 `构思/<name>.md`，expectedRevision 乐观并发，空 text 拒绝）；manifest `tools` 数组同步加这两个名字。
  2. `next/shell/useBoardData.mjs`：notes 列表/选中/草稿状态，照 chapters 的既有形态。
  3. `next/shell/IndexWindow.vue`：章节树后加「构思」区（`.workspace-nav-section` + `.workspace-nav-item` 树词汇），行可点开；`next/shell/CarrierPaneHost.vue`：novel 板块加 notes 视图分支（标题＋textarea `.editor-area`＋保存 `.control-primary`，照章节编辑器形态）。
  4. 测试：`carrier-novel.test.mjs` 补 notes list/save 用例（含 expectedRevision 不符被拒）；界面测补 notes 打开与保存用例。
- **边界**：不做富文本、不做速记快捷入口；命名 `notes` 不叫 `ideas`（与 dataDirs 一致）。

## 2. 工单 B2：大纲节点编辑（outline.tree 的写半边）

- **依据**：novel scopes 已有 `file:大纲:rw`；`pinax_outline_read` 已认领（`next/carriers/novel/tools.mjs`，返回形状以该实现为准）；批次11（进行中）把大纲只读树接进索引窗。
- **任务**：
  1. `next/carriers/novel/tools.mjs`：新增 `pinax_outline_save`：吃完整 `nodes[]`（形状 = `pinax_outline_read` 的返回文档），经 `fileService.write` 落 `大纲/outline.json`（expectedRevision）；拒绝空 nodes 与非法 JSON 结构（缺 `nodes[]` 即 INVALID_INPUT）。
  2. 索引窗大纲行（批次11 落的那棵）升级两种编辑：节点**改名**（行内编辑或选中后中栏改名）与**新增同级/子节点**；不做拖拽重排（记账到后续批）。
  3. 编辑入口与保存流照章节编辑器模式（draft → save → revision 递增提示）。
  4. 测试：outline save 三用例（成功/revision 不符/非法结构）；界面测改名与新增走工具通道。
- **前置依赖**：批次11 工单 A3（大纲树）已合入工作副本。若 A3 未落地，先做 B1/B3，B2 等通知。
- **边界**：本批不接 MCP 侧 `pinax_outline_read` 的信封语义改动；只做载体交互写。

## 3. 工单 B3：MCP 工具面 ↔ 载体工具 ↔ UI 入口 对齐核对（文档交付）

- **依据**：作者要求「前后端保持同样契合度」；规范 v1 §12 欠项「插件 tools 与 19 个 pinax_* 工具的一对一映射尚未逐工具核对」。
- **任务**：产出 `docs/plan/next-mcp-tool-alignment-20261028.md`：
  1. 逐个列 19 个 MCP 工具（`server/mcp/tools/*`）：载体侧认领状态（哪个 carrier、同名还是映射）、Next UI 入口有无（索引窗/中栏/右栏）、缺口分级（A=作者日常会被卡 / B=有替代路径 / C=公网或导出专用可长期无 UI）。
  2. 逐个列载体自有工具（chapter_save、worldbook_save、notes_save、outline_save…）：MCP 侧有无对应语义、写口径是否一致（直接写 vs 提案）。
  3. 缺口按价值排序，能立项的写成「后续工单候选」段（只列名与一句话，不展开）。
- **边界**：纯文档；不改代码；引用处给 path:line。

## 4. 认领表

| 工单 | 认领会话 | 开始时间 | 状态 |
|---|---|---|---|
| B1 构思/速记 | — | — | 待认领 |
| B2 大纲节点编辑 | — | — | 待认领（依赖批次11 A3） |
| B3 工具面对齐核对 | — | — | 待认领 |

## 5. 执行结果回填

（执行方填：改动文件清单、verify:next 五段数字、诚实边界、异常与踩坑。）

## 6. 验收与提交（Zcode 会话填）

（工单完成后由 Zcode 验收：diff 复核、独立复跑 verify:next、真窗口截图，然后统一提交推送并回填本节。）
