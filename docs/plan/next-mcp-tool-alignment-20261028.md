# MCP 工具面 ↔ 载体工具 ↔ Next UI 入口 对齐核对（2026-10-28）

> 目的：回收规范 v1 §12 的欠项——「插件 tools 与 19 个 pinax_* 工具的一对一映射尚未逐工具核对」；
> 回答作者那句「前后端保持同样契合度」：**每把内核工具谁在服务、作者在界面上能不能摸到、摸不到算不算缺口**。
> 方法与边界：
> - 19 工具清单以 `server/mcp/createMcpServer.js:21-31` 的聚合数组为准，逐个给出 `server/mcp/tools/*` 的定义行；
> - 认领状态以 `next/carriers/novel/manifest.mjs:41` 与 `next/carriers/setting/manifest.mjs:39` 的 tools 数组为准
>   （同名认领＝接管内核同名工具，面不虚增；载体自有＝内核没有的新名字，进 `skeleton-contract` 的留名清单）；
> - UI 入口以 2026-10-28 对 `next/shell/` 的逐名 grep 为准。**「调用入口」指外壳真的经 runtimeToolCall/IPC 发起调用**
>   （全部收在 `next/shell/useBoardData.mjs:50` 这一条通道上）；右栏「工具面」折叠列表（`next/shell/RuntimeDock.vue:25`）
>   只把面上名字只读列出——那是可见性，不算入口，本表不认。
> - 缺口分级按工单口径：**A＝作者日常会被卡 / B＝有替代路径 / C＝公网或导出专用、可长期无 UI**。
>   分级是判断题不是门禁，判据随行写明。纯文档，不改代码。

## 0. 结论先行

1. 19 个内核 MCP 工具：**5 个被同名认领**（novel 认领 3 把读：chapter_list/chapter_read/outline_read；setting 认领 2 把读：worldbook_list/worldbook_read），**14 个未认领**（聚合面上内核兜底；其中写族受 kernelWriteGuard 约束）。归属核对由 `next/runtime/mcpSurface.mjs:82-102`（toolOwnershipReport）与 `next/tests/runtime-inprocess.test.mjs:117-131` 把守：claimed=5、unclaimed=14、自有名单逐条留名。
2. **5 个被认领的读工具全部有 UI 调用入口**（章节树＋点章载入、大纲树、世界书清单＋条目阅读），零缺口。
3. **载体自有 5 把全部有 UI 调用入口**（正文保存/新建、大纲保存、构思列/存、世界书条目保存）；MCP 侧「写」的语义与它们**刻意不同轨**（agent→提案/导入闸，作者→带修订号直写），两条轨由 kernelWriteGuard 互相隔离，见 §2。
4. 真正的 UI 缺口集中在四件：**提案审阅（A）**、**既有稿导入（B）**、**约束编辑（B）**、**资料/RAG（B，归 M3）**。项目定位类与专家类是 agent 基建，可长期无 UI（C）。

## 1. 19 个内核 MCP 工具逐个核对

| # | 工具（MCP 定义处） | 载体侧认领 | Next UI 调用入口 | 缺口 | 一句话判据 |
|---|---|---|---|---|---|
| 1 | `pinax_project_list`（projectTools.js:21） | 未认领 | 无 | C | agent 定位项目用；作者的开项目入口在启动 autoOpen＋主载体闸（`next/shell/AppNext.vue`），不靠这把 |
| 2 | `pinax_project_open`（projectTools.js:29） | 未认领 | 无 | C | 同上；打开失败停在 D1 主载体弹窗，不走这把 |
| 3 | `pinax_project_init`（importTools.js:29） | 未认领 | 无（等价入口＝新建项目弹窗：projectCreate→session.create） | C | 作者建项目的等价物已在「文件 → 新建项目…」弹窗里 |
| 4 | `pinax_project_import`（importTools.js:139） | 未认领 | 无 | **B** | 既有稿整目录导入是门槛级的一次性动作；替代路径只有 MCP/服务端轨，产品内无路 |
| 5 | `pinax_project_context`（projectTools.js:42） | 未认领 | 无 | C | agent 组上下文用（服务端合同还只认 @1，缺口记在 legacy-interoperability） |
| 6 | `pinax_chapter_list`（chapterTools.js:16） | **novel 同名认领** | useBoardData.mjs:60 → 索引窗章节树 | 无 | 认领＝同名接管，`runtime.ownerOf` 实测归 novel |
| 7 | `pinax_chapter_read`（chapterTools.js:37） | **novel 同名认领** | useBoardData.mjs:79 → 点章载入编辑器 | 无 | 同上 |
| 8 | `pinax_chapter_write`（writeTools.js:6） | 未认领（写族闸点名） | 无 | **A** | 模型改稿只落 `.pinax/proposals/`，**Next 没有任何审阅提案的面**——AI 协作闭环的收口缺 UI |
| 9 | `pinax_chapter_import`（importTools.js:115） | 未认领 | 无 | B | 替代：UI 新建章节后粘贴；批量导文本走 MCP |
| 10 | `pinax_outline_read`（outlineTools.js:16） | **novel 同名认领** | useBoardData.mjs:288 → 索引窗大纲树（B2 起可点选编辑） | 无 | 同 6 |
| 11 | `pinax_worldbook_list`（worldbookTools.js:16） | **setting 同名认领** | useBoardData.mjs:211 → 索引窗条目树 | 无 | 同 6 |
| 12 | `pinax_worldbook_read`（worldbookTools.js:36） | **setting 同名认领** | useBoardData.mjs:230 → 条目阅读/编辑面 | 无 | 同 6 |
| 13 | `pinax_worldbook_write`（importTools.js:74） | 未认领（写族闸点名） | 无直接入口；作者改条目走载体 `pinax_worldbook_save` | C | 作者侧语义已被载体 save 覆盖；MCP 面留作 agent 导入通道（direct-write＋overwrite:false 默认拒覆盖） |
| 14 | `pinax_rule_write`（importTools.js:51） | 未认领 | 无 | **B** | `约束/` 在 Next 无任何编辑 UI（setting 对它只申请 `file:约束:r`，manifest.mjs:46）；替代＝外部编辑器直接改目录里的 md，且属低频动作 |
| 15 | `pinax_knowledge_search`（knowledgeTools.js:49） | 未认领 | 无 | **B** | 资料域未迁（盘点文档归 M3）；工具本身 agent 可用，作者侧检索入口随资料域走 |
| 16 | `pinax_project_index`（knowledgeTools.js:26） | 未认领 | 无 | **B** | RAG 是目录的派生投影；同 15，归 M3 |
| 17 | `pinax_agent_ask`（agentTools.js:16） | 未认领 | 右栏提问即其产品化入口（`next/runtime/agentRuntime.mjs:121-123`：给 advisorBaseUrl 时直调这把；默认走注入的 runner） | C | 作者要的是「能问」，UI 已有；这把是它的 MCP 形态 |
| 18 | `pinax_expert_list`（expertTools.js:50） | 未认领 | 无 | C | 专家选择器属老前端 advisor UI，随助手域迁移再议 |
| 19 | `pinax_expert_invoke`（expertTools.js:68） | 未认领 | 无 | C | 同 18 |

小结：**A×1（提案审阅）、B×5（导入/约束/资料×2/批量导入）、C×8、无缺口×5**。14 个未认领里没有任何一个出现「载体抢注导致作者入口变窄」——认领面（5）与 UI 面（5）严格重合。

## 2. 载体自有工具 × MCP 侧语义（写口径对照）

聚合面总账：19 内核 ∪ 载体声明＝24，其中 10 个名字由载体服务（5 接管＋5 自有）——`next/testing/acceptance.mjs`「M2 聚合工具面」record 实测（2026-10-28 跑：toolCount=24 carrierTools=10）。

| 载体自有工具（实现处） | MCP 侧对应语义 | 写口径对照 | UI 入口 |
|---|---|---|---|
| `pinax_chapter_save`（novel/tools.mjs:213，写盘 :241） | `pinax_chapter_write`（writeTools.js:6-13）：**提案轨**——只写 `.pinax/proposals/` 审阅提案，绝不修改 `正文/` 原稿 | **刻意不同轨**：agent 永远提案、作者按了才落盘（`正文/` 直写＋expectedRevision 乐观并发，新建传 0）。聚合面上未认领的内核写族被 kernelWriteGuard 整组拒（acceptance「M2 写族闸」record：拒=INVALID_INPUT/SCOPE_NOT_GRANTED），两条轨互不可冒充 | 章节编辑器保存/新建（useBoardData.mjs:99、:118） |
| `pinax_worldbook_save`（setting/tools.mjs:180，写盘 :212） | `pinax_worldbook_write`（importTools.js:74-110）：**直写但带导入闸**——按世界书文件契约 v2 序列化落 `世界书/<分类>/`，同名同 id 默认拒覆盖（overwrite:true 才放行） | **同向不同闸**：两边都直写、都用同一份文件契约（契约条目保留 frontmatter，裁定 dwfq-f2369ffa-2）；载体侧把「防覆盖」换成 expectedRevision 乐观并发，作者链路不受 overwrite 语义影响 | 条目编辑保存（useBoardData.mjs:264） |
| `pinax_notes_list`（novel/tools.mjs:305） | **无对应**——内核 19 里没有任何构思/速记读法（工单B1 新增的自有面）；正文随篇目带回，单篇截 20000 字并标注 | 只读；速记的 MCP 侧消费方将来若出现，应认领同名而不是另写 | 索引窗构思区＋构思编辑面（useBoardData.mjs:134） |
| `pinax_notes_save`（novel/tools.mjs:327，写盘 :355） | **无对应**（内核没有构思写口） | 作者直写 `构思/`：expectedRevision 乐观并发、空 text 拒、非 .md 拒 | 构思编辑器保存/新建（useBoardData.mjs:171、:193） |
| `pinax_outline_save`（novel/tools.mjs:253，写盘 :293） | **无对应**——内核只有 `pinax_outline_read`（outlineTools.js:16），大纲在 MCP 面上没有写半边 | 作者整份覆盖 `大纲/outline.json`：nodes 全量回传（不收增量、不合并）、expectedRevision 乐观并发、空/非法结构拒；MCP 侧若将来给 agent 开大纲写口，应走提案轨对齐 chapter_write 的先例，不走直写 | 大纲编辑面保存（useBoardData.mjs:361） |

**写族口径总结**：MCP 侧的「写」分两族——提案（chapter_write）与导入闸（project_init/project_import/worldbook_write/rule_write/chapter_import，公网整组禁用，各工具 description 原话）；载体侧的「写」一律直写但全过文件服务三道闸（目录归属＋`file:<目录>:rw` scope＋修订并发，`next/fs/fileService.mjs`）。两侧唯一的语义重叠在世界书：`pinax_worldbook_write`（agent 导入）与 `pinax_worldbook_save`（作者编辑）写同一目录同一契约，靠调用者与并发闸区分——这是目前唯一值得在后续工单里写进规范正文的约定。

## 3. 缺口按价值排序 与 后续工单候选

排序判据：作者日常感知 × 产品内有无替代路径。

1. **提案审阅面**（对应 §1 #8，A）——模型改稿的产出没有任何界面承接，AI 协作闭环断在最后一米。
2. **既有稿导入**（#4，B）——老作者带稿上车的一次性门槛，产品内无路。
3. **约束编辑**（#14，B）——`约束/` 直接进上下文信封（rules 块），作者却只能去外部编辑器改。
4. **资料/RAG 最小面**（#15/#16，B）——归 M3 资料域，工具已就位只欠 UI。
5. **批量章节导入**（#9，B→C）——有粘贴替代，优先级随导入向导顺带。
6. **专家选择器**（#18/#19，C）——随助手域迁移再议，不单独立项。

### 后续工单候选（只列名与一句话，不展开）

- **提案审阅最小面**：索引窗或弹窗列 `.pinax/proposals/`，可读可弃；采纳仍走作者直写轨，不新增旁路。
- **导入既有稿向导**：菜单入口接 `pinax_project_import` 的 dryRun→落盘两步，复用新建项目弹窗的形态。
- **约束编辑最小面**：`约束/` 清单＋文本编辑；先裁 scope 归属（setting 的 `file:约束:r` 是否升 rw 或 novel 自有写口）再动手。
- **大纲树层级渲染**：按已有 edges 把子级缩进显示（B2 数据已落盘，纯显示层）。
- **（M3 归属）资料域最小面**：`资料/` 清单＋检索入口，接 `pinax_knowledge_search`。

## 4. 核验

本文档为纯文档交付，不进门禁。2026-10-28 按工单要求实跑 `npm run verify:next` 一遍以证明无误伤，结果见交付说明（应为全绿；若此后有人改代码导致变红，与本文件无关）。
