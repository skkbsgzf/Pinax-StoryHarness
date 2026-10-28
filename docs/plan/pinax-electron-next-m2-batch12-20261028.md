# Pinax-Electron-Next M2 批次12：弹窗化统一（U13）＋构思/速记＋大纲节点编辑＋工具面对齐核对（2026-10-28）

> 作者指令：①U13——所有配置项/设置页/顶栏延伸功能配置一律圆润弹窗，核心工作区纯净（已入一致性规范）；②风格没问题就继续推功能迁移。
> 执行模式与批次 11 相同：调度方（Zcode）调研派单 → coder（GLM-5.3-Flash 动态工作流）执行 → 调度方验收修复提交。
> 工单全文：[批次12 派工单](./pinax-electron-next-m2-batch12-dispatch-20261028.md)（B0–B3）。

## 1. 四张工单的交付（工单侧与验收侧门禁各自独立实跑，均一次全绿）

**B0 核心区弹窗化统一（U13 落地）**
- 新原语 `next/shell/WorkbenchModal.vue`：遮罩 `--surface-overlay` + 层级 `--z-modal-backdrop` + 圆角 `--radius-surface` + `.modal-fade-*` 过渡，全部 legacy token；dismissable 弹窗支持遮罩/Esc/关闭钮，非 dismissable（主载体选择）三者皆无。
- 四个核心区 section 全部迁入弹窗：偏好与模型、载体管理、新建项目（dismissable）；主载体选择（needsPrimary 自动打开、D1 硬闸不可关）。AppNext 的 col-center 不再有任何 wizard/配置 section。
- 「文件 → 新建项目…」（`project.create`）死菜单接线补全。
- 视觉合同加断言：AppNext 源码禁 `class="wizard"`；WorkbenchModal 必须用三个弹窗 token。
- 截图：`png/13-light-modal-prefs.png`（浅色弹窗，核心区正文在遮罩后可见）、`14-dark-modal-prefs.png`（深色，U12）、`15-dark/16-light-modal-carriers.png`（载体管理明暗双拍）。

**B1 构思/速记**
- novel 载体 +`pinax_notes_list`（篇目随手带回全文，单篇截 2 万字）/`pinax_notes_save`（expectedRevision 乐观并发）；索引窗第四棵树「构思」＋中栏 notes 视图＋新建构思（标题作首行落盘）。截图 `png/17`（四棵树）、`png/18`（构思编辑）。
- 设计取舍（coder 提出调度方认可）：速记都短，list 随手带全文省一次读；loadNotes 不自动打开任何一篇（正文是核心区主角，与章节「自动开最后一章」是有意差异）。

**B2 大纲节点编辑**
- novel 载体 +`pinax_outline_save`（整份 nodes[]/edges 覆盖，expectedRevision；拒空/缺 nodes[]/缺 id/title/edges 非数组；节点其余字段如 summary 原样保留不洗掉）；索引窗大纲行从静态 span 变可点选，改名走中栏草稿、加节点（平铺 schema 本义＝紧随所选插入＋记 from→to 连线）；未建档时给「新建大纲」起单节点草稿（expectedRevision 0 建档）。截图 `png/19`。
- 层级语义取证：outline.json schema 本就平铺（server/mcp/localProjects.js:208-227 无 parent 字段，老前端 AuthoringOutlinePanel 亦无 depth）——「子节点」按 schema 本义实现，不自造层级。

**B3 工具面对齐核对（文档）**
- 新增 `docs/plan/next-mcp-tool-alignment-20261028.md`：19 个 MCP 工具逐个对账（载体认领状态/UI 入口有无/缺口 A·B·C 分级）＋载体自有写口与 MCP 语义比对。「Next UI 入口」判据＝shell 真正发起 runtimeToolCall 的调用点（右栏工具面折叠列表只列名不算入口）。缺口分级是判断题，作者可改。

## 2. 断言同步预授权的执行情况（批次11 裁定的固化生效）

B1/B2 各加载体自有工具使聚合面 21→23→24（右栏工具面计数同帧可见），涉及 4 个清单外文件的断言（acceptance 聚合面 record、CARRIER_OWN_TOOL_ALLOWLIST 留名、declaredOutsideKernel、kernel-write-guard 拒绝语）。按批次 11 裁定 dwfq-f2369ffa-1/3 的常备授权直接同步（只改断言事实、不动判定逻辑、不增删用例），coder 在 limitations 里逐处列明——**本批零升级**，对比批次 11 的三次升级，预授权机制生效。

## 3. 验收阶段调度方另修

- **createChapter 空稿 bug（B1 顺带发现、调度方验收修复）**：索引窗「新建章」发 `text:''`，对真 `pinax_chapter_save` 必被拒——界面上新建章节一直是坏的（此前演示章均由文件侧播种，未暴露）。照 B1 createNote 的正确先例改为标题作首行落盘（`text = '<标题>\n'`），同步 carrier-pane 断言。

## 4. 门禁与截图

- 调度方独立复跑 `verify:next`：验收 16/16、内核单测 **138/138**、外壳界面测 **43/43**、eslint 0 警、打包 a–k 全过。
- 截图（`D:\Pinax-e2e\next-batch7-shots\png\`）：13/14 偏好弹窗明暗、15/16 载体管理弹窗明暗、17 四棵树、18 构思编辑、19 大纲编辑。

## 5. 诚实边界

- 弹窗遮罩盖竖条：弹窗开着时切主题要先关弹窗（截图脚本已按此序）；「弹窗开着时给竖条留一条快捷通道」是产品取舍，未做。
- 主载体选择弹窗 aria-label 由「主载体选择」改为标题文案「这个项目要创作什么？」（WorkbenchModal 用 title 兼 aria-label）——屏幕阅读器口径变化，记账。
- outline「子节点」受平铺 schema 限制只记连线不画层级；拖拽重排、散文稿大纲 warning 上面板、速记改名仍记账未做。
- 新建项目弹窗改为仅菜单可达后，无项目首屏的核心区没有任何入口按钮（U13 口径下的刻意形态）；若作者希望首屏向导化（自动弹一次新建），待裁。
- B3 的 A/B/C 定级与「入口」判据是执行方判断（判据已逐行写在文档内），作者可改。
- 真模型调用、Forge 安装态仍未验证（与本批无交集，延续记账）。
