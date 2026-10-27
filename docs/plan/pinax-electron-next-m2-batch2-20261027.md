# Pinax-Electron-Next · M2 批次 2 验收记录（2026-10-27）

> 上位文档：[规范 v1](./pinax-electron-next-spec-20261027.md)、[M1 验收记录](./pinax-electron-next-m1-acceptance-20261027.md)、[M2 批次 1 验收记录](./pinax-electron-next-m2-batch1-20261027.md)。
> 本档只记「跑出来什么、数字多少、哪些没覆盖」。所有数字来自今天本机工作副本的实测，按第 6 节命令可复现。

## 0. 结论先行

**批次 1 欠的那条最大的账——「模型给一个绝对路径就能绕过板块权限、绕过修订号闸，直接写作者的原稿目录」——本批收口了，而且是收在调用链路上，不是写在文档里。** `npm run verify:next` 五段全绿：真载体＋空框架混合验收 **16/16**（新增记录 ⑭）、内核单测 **105/105**（新增 8 条写族闸判据）、外壳界面测 **20/20**（真链路那条里伪造的内核写调用从 1 个探针换成 3 个）、`eslint next` 零告警、打包门禁全过，exit 0。

做法上先说清楚选的是哪条路。批次 1 记录留了两选一：把 7 把内核写工具逐块认领进板块，或者在 Next 侧给写族加一道闸。本批选的是**加闸**，理由是认领会改变产品口径——设定板块的 `世界书/约束` 一旦申请 `:rw`，就等于允许模型直接改作者的设定档，而作者定的最硬的一条是「只新增不动原稿」；闸则把「运行时写进项目目录」这件事继续只留给带修订号的板块通道和 `.pinax/proposals/` 提案轨。名单不是我圈出来的，是从内核自己的 `annotations.readOnlyHint === false` 现取的（`next/runtime/kernelWriteGuard.mjs:31`），所以内核新增一把会写盘的工具而没在分类表里定性，`verify:next` 就红（第 3 节第 1 条）。

四条没做成的事，如实记账：① **仍然一次真模型都没打过**——runner 只在 Electron 主进程注入（`next/shell/main.mjs:86`），测试与验收轨道刻意不注入，「问一句话」拿到的仍是 `PINAX_DEPENDENCY_UNMET`；② **写族仍是「被拒」而不是「被认领」**，M2 的进度尺 `claimed 5 / unclaimed 14` 本批没动，未认领的 14 个名字里这 7 把现在只会挨拒；③ **闸只装在 Next 的三个出口**（运行时聚合面、stdio 出口、验收里的真运行时），作者现在还在用的服务端 HTTP MCP 轨（本机 3001）一行没改，行为照旧；④ 真实 Electron 窗口仍未在屏幕上看过，证据链还是 jsdom 真链路渲染测＋产物文本取证。

---

## 1. 这一批交付的四块东西

**写族闸本体（新文件 `next/runtime/kernelWriteGuard.mjs`，149 行）。** 三条判据按顺序执行，全部可机读：

1. 定位只有一条路。Next 打开的项目不在服务端注册表里，所以带 `projectId` 一律 `PINAX_INVALID_INPUT`——连空串和纯空格也拒，形状含糊不许静默当成没给（`kernelWriteGuard.mjs:90`）；给了 `projectPath` 但不是当前根，按 `PINAX_PATH_OUTSIDE_PROJECT` 拒（`:97`）；两者都没给，由闸把当前根注入进去，调用方无从选择第二个目录（`:121`—`:123` 的 `ok({args:{...input, projectPath: current}})`）。没绑定项目根时写族整组拒（`:84`）——stdio 出口那句「不改项目文件」的宣称到这里才变成事实。
2. 一目录一主人。目标目录被哪块已安装板块认领，写就只能走那块：主人从 `registry.dirClaims()` 现查（`:134`），拒的时候点名主人和合法路径——`正文/` 拒 `pinax_chapter_write` 时把 `pinax_chapter_save`（带 `expectedRevision`）指出来，`世界书/` 的主人设定板块只有 `:r`，所以拒的话术是「改动只能以提案形式落 `.pinax/proposals/`」，不假装有条写通道。查不到主人的目录（关掉某块板块后的 `世界书/` 是一例）仍由内核兜底，但只允许写进当前根。
3. 结构动作与派生动作不放行。`pinax_project_init`／`pinax_project_import` 会改骨架本身或跨多个目录，归服务端轨，Next 运行时整组拒；`pinax_project_index` 的 `action:"status"` 是只读盘点照旧可用，`action:"sync"` 会 HTTP 打本机服务，按 `PINAX_DEPENDENCY_UNMET` 拒并给出改用 `status` 的话术。

**接在调用链路上。** 聚合面新增 `guard` 参数，内核兜底分支在把请求转给内核实现之前先过闸，判定不通过就直接把信封转成 MCP 结果，内核那行代码根本不执行（`next/runtime/surfaceAggregate.mjs:83`—`:89`）。`createRuntimeSurface()` 现在无条件走聚合面（`next/runtime/mcpSurface.mjs:53`）——以前没载体时返回的是裸内核 server，那样 M1 空框架轨就没有闸，两条代码路径迟早漂移；现在一条路径，`aggregated` 只表示面上有没有载体工具。根的取法是 `projectRoot ?? view?.root ?? fileService?.root`，写进 `surface.writeGuard`（`:65`）并由 `runtime.surfaceInfo()` 透出（`next/runtime/agentRuntime.mjs:68`）。stdio 出口同样走 `createRuntimeSurface()`（`next/runtime/stdioEntry.mjs:12`），启动日志直接把「写族 N 把因未绑定项目根而拒」打出来。旧的 `createMcpSurface()` 一字未动，作者的整目录导入工作流不受影响。

**归一比只有一个地方。** 「是不是当前项目」这句话载体和闸必须说同一个意思，所以在 `next/fs/projectPath.mjs:70`/`:75` 加了 `normalizeProjectRoot()`／`isSameProjectRoot()`（反斜杠、尾斜杠、大小写盘符归一，Windows 路径写法五花八门不算越界），设定板块的 `checkProjectRef` 也改成调这两个函数（`next/carriers/setting/tools.mjs:2`/`:39`）。闸的注入与板块的比对共用这一份规则。

**界面与文案把口径讲出来。** 右栏运行时面板多一行「写族闸 7 把：只认当前项目根（`D:\...\靶子`）」，未绑定项目时显示「（未绑定项目＝整组拒）」（`next/shell/RuntimeDock.vue:97`—`:100`），载体接管数为 0 时也注明「面内无载体工具＝内核兜底＋写族闸」。世界书面板的空态从「还没有条目」改成说清为什么不能在这儿加：这块目录由设定板块认领且只申请了只读，要加设定先让运行时出提案（`next/shell/CarrierPaneHost.vue:242`）。

## 2. 实测数字

| 段 | 命令 | 结果 |
| --- | --- | --- |
| 验收（M1 ①–⑦ ＋ M2 ⑧–⑭） | `node next/testing/acceptance.mjs` | **16/16**（批次 1 是 15/15）。新增 ⑭：`surfaceInfo().writeGuard` 列出 **7** 把且根＝真载体靶子目录；真运行时上 4 次伪造调用全被拒——按 id＝`PINAX_INVALID_INPUT`、给当前根写 `世界书/`＝`PINAX_SCOPE_NOT_GRANTED`、写 `正文/` 的 message 里点名 `pinax_chapter_save`、`pinax_project_init` 建新项目＝`PINAX_SCOPE_NOT_GRANTED`；拒后 `世界书/`＋`约束/` 目录清单逐字未变，`闸门外的新项目` 在磁盘上不存在 |
| 内核/合同单测 | `node --test "next/tests/*.test.mjs"` | **105/105**（批次 1 是 97，本批 ＋8，全在新文件 `next/tests/kernel-write-guard.test.mjs`）：名单与分类表对账（三个缺口数组必须空）、非写族原样放行、foreign 路径拒＋三种等价写法放行＋没给就注入、`projectId` 一律拒、认领目录拒且未认领目录兜底（只装小说板块时 `世界书/` 仍可写，标 `unclaimed`）、结构动作与 sync 拒、未绑定根全拒而读工具照过、真运行时端到端 |
| 外壳界面测 | `vitest run --config next/vitest.next.shell.config.mjs` | **20/20**，三个文件不变（`shell-ui` 8、`carrier-pane` 9、`carrier-pane-real` 3）。真链路那条第 2 个用例的取证升级：批次 1 只能证「内核按注册表找不到这个目录所以拒」，本批三个探针分别是 `projectId`→`PINAX_INVALID_INPUT`、当前根写 `世界书/`→`PINAX_SCOPE_NOT_GRANTED`（`/世界书\/ 的主人/`）、`pinax_chapter_write`→`PINAX_SCOPE_NOT_GRANTED`（message 含 `pinax_chapter_save`），三次都断言 `owner==='kernel'`（拒的是闸，不是「查无此项目」），前后目录清单逐字比对 |
| 源码 lint | `npm run lint:next` | 0 错 0 警（`--max-warnings 0`） |
| 打包门禁 | `node next/testing/bundleAssertions.mjs` | 全过：主进程 bundle **861.2 kB**（批次 1 855.5，闸进包 ＋5.7 kB）、渲染层 js **235.1 kB**（前 234.6）、产物内 express 命中 **0**、外部说明符 10 条全在 electron／`node:*`／原生模块白名单内、import 产物后 in-process 列出 **19** 工具、`KERNEL_INFO.contractVersion=1` |
| 规模 | `next/` 源码（排除 `node_modules/dist/.build`） | **67 文件 / 8300 行**（批次 1 65/7889）。按目录：`tests` 16/2708、`shell` 11/1222、`runtime` 9/963（批次 1 是 8/785，本批 ＋`kernelWriteGuard.mjs` 149 行）、`carriers` 7/944、`kernel` 7/901、`testing` 4/473、`project` 4/417、`fs` 3/384、根 6/288 |

## 3. 门禁口径的三处变化

这批的价值不在功能而在「说谎就红」，所以逐条给机读判据：

1. **写族名单与分类表必须严丝合缝。** `guardClassificationGaps()` 返回 `unclaimed`（内核说它会写盘但分类表没定性）、`staleEntries`（定性了但内核没这把工具）、`outsideKernel`（写了个不存在的名字）三个数组，测试要求全空（`kernel-write-guard.test.mjs:37`）。内核将来加写工具而不分类，聚合面就带着一个没定性的名字上线——这条把它拦在提交链路上。
2. **空框架轨也在闸内。** `createRuntimeSurface()` 不再有条返回裸内核 server 的分支，所以「M1 说运行时不改项目文件」这类宣称必须有闸兜着；测试第 7 条专门用 `root: null` 打一遍写族，读工具照过、写族整组拒。
3. **拒的时候必须把合法路径说清楚。** 认领目录的拒绝带 `details:{tool, dir, owner, ownerScopes}`，message 里要么点名主人的自有写工具（从该板块声明中**非内核同名**的那些里挑，`kernelWriteGuard.mjs:105`—`:118`），要么如实说「这块板块没有写通道，只能出提案」——不许用一句「权限不足」把作者引到一条其实不存在的路上。

M2 的进度尺本身没推进：`claimed 5 / unclaimed 14`（`next/runtime/mcpSurface.mjs` 的 `toolOwnershipReport`），`toolOwnership` 测试仍钉着。认领与加闸是两件事，本批做的是后者。

## 4. 复现

```bash
npm run verify:next          # 五段全跑，exit 0
node next/testing/acceptance.mjs                             # 16/16
node --test next/tests/kernel-write-guard.test.mjs           # 8/8
node --test "next/tests/*.test.mjs"                          # 105/105
npx vitest run --config next/vitest.next.shell.config.mjs     # 20/20
npm run lint:next            # 0 错 0 警
node next/testing/bundleAssertions.mjs                       # 打包门禁
```

## 5. 未覆盖项与待裁定（逐条给去处）

1. **「目录没主人＝内核兜底可写」这一支今天实际打不到，但它是留着的一条口子。** 分类表把 7 把写工具逐一钉在固定目录上（`正文`／`世界书`／`约束`），这三块在内置发布里都有主人，所以全被拒；`资料/`、`日志/` 目前没有任何内核写工具指向它们。真正能打到的例子是关掉设定板块之后：`世界书/` 变成未认领，`pinax_worldbook_write` 就放行（测试第 5 条断言的就是这个形状——`ok:true`，`class:{dir:'世界书', unclaimed:true}`），进去之后既不审板块 scope 也不审修订号。也就是说闸管住了「写到哪个根」，没管住「未认领目录里的写法」。**待裁**：未认领的骨架目录要不要也上一道 revision／scope 审，还是靠「内置发布就把七块目录认领干净」来消掉这一支。
2. **Next 运行时建不了第二个项目、导不了整个文件夹。** 结构动作整组拒（判据 3），所以「在 Next 里新建项目」只能走外壳自己的向导（`createProject`），整目录导入目前只在服务端 MCP 轨。这与批次 1 已裁的「MCP 走本地文件夹轨、映射只新增不动原稿」一致，但如果作者希望 Next 窗口内也能导入，需要单独设计一条走 `fileService` 的导入轨。**待裁**。
3. **知识索引的 `sync` 在 Next 里被拒。** `pinax_project_index` 的 `action:"status"` 照过，`sync` 会 HTTP 打本机服务，与「Next 零端口、不依赖 3001 在跑」冲突。**待裁**：要不要给 Next 一条进程内编目轨（不带 HTTP），还是继续只用 status 盘点。
4. **写族的最终归属还没裁。** 本批用闸把后门关上，但 `claimed` 仍是 5。若日后希望设定能改（例如「把这次对话里定的新设定建档」），要么设定板块申请 `:rw`＋修订号（那就等于允许模型直接改原稿档，我不建议），要么把「改动只进 `.pinax/proposals/`，作者点头才落盘」写成产品口径。**我按后者实现，需要作者确认这是长期口径。**
5. **一次真模型调用都没有**（批次 1 §5.1 原样欠着）。批次 3 第一件实事应该还是它：临时项目上真调一次上游，把回答＋`sourceRefs`＋预算裁剪（`dropped`／`已裁剪`）摆成证据；上游断了不由我代答。
6. `next/carriers/.gitkeep` 残留与其配套的点文件过滤、真实窗口的肉眼验收、Electron ABI 档／RAG 打包形态／CI 接线——六条与批次 1 记录同状态，本批未推进。

## 6. 批次 3 的入口（不在这批做）

先打真模型那一调并出证据（第 5 节第 1 条），这是「运行时能问」这句话第一次有机会被真正证明；同批把第 5 节第 1、3、4 条的作者裁决落进代码与门禁。设定板块的检索／关系图／大纲树排在它们后面——那是功能密度，不是口径缺口，不该插在有后门没关、有主张没证据的时候进来。夹具轨道仍然活着：`next/testing/fixtures.mjs` 与 `unclaimed 14` 同时被测试钉着。
