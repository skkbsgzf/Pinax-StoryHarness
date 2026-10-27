# Pinax-Electron-Next · M2 批次 1 验收记录（2026-10-27）

> 上位文档：[规范 v1](./pinax-electron-next-spec-20261027.md)、[M1 实现方案](./pinax-electron-next-m1-plan-20261027.md)、[M1 验收记录](./pinax-electron-next-m1-acceptance-20261027.md)。
> 本档只记「跑出来什么、数字多少、哪些没覆盖」。所有数字来自今天本机工作副本的实测，按第 6 节命令可复现。

## 0. 结论先行

**M2 批次 1 判据达成：`next/carriers/` 里第一次有了随框架发布的真板块，工具面、外壳面板、门禁三件事同时换了口径。** 一条命令 `npm run verify:next` 串起五段全绿（真载体＋空框架混合验收 **15/15**、内核单测 **97/97**、外壳界面测 **20/20**、`eslint next` 零告警、打包门禁全过），exit 0。

具体换成了什么：小说板块认领 `正文/大纲/构思`，设定板块认领 `世界书/约束` 且只申请只读；工具面从「内核 19」变成「内核 ∪ 载体声明＝**20**，其中 **6** 个名字由载体服务（5 个同名接管＋1 个载体自有）」；外壳中栏不再画占位块，它按 pane id 挂真实面板，读的是磁盘上的真章节、保存带修订号、只读板块一个字节都写不出。门禁口径也跟着换：M1 那条「carriers 必须为空」删掉，换成 M2 的四条机读判据（第 3 节），仍然挂在 `verify:next` 的提交链路上，不是文档里的口头规矩。

四件没做成的事，如实记账：① **没打过一次真模型**——runner 只在 Electron 主进程里注入（`next/shell/main.mjs:86`），测试与验收轨道刻意不注入，所以「问一句话」拿到的是 `PINAX_DEPENDENCY_UNMET` 而不是回答，回答质量这条主张今天不成立；② 内核 19 个名字只认领了 5 个，剩下 14 个仍由内核兜底，其中 `pinax_worldbook_write`／`pinax_rule_write` 这类写工具接受任意 `projectPath`，绕开板块的 `r` 权限与修订号闸（第 5 节第 2 条，批次 2 要裁的第一件事）；③ 真实 Electron 窗口仍未在屏幕上看过，证据链是 jsdom 真链路渲染测＋产物文本取证；④ `pinax-project@2` 的服务端双向互开仍未解，旧测试钉着失败。

---

## 1. 这一批交付的四块东西

**载体上盘。** `next/carriers/novel/`（manifest＋tools＋context）认领 `正文/大纲/构思`，声明 4 个工具名：3 个是从内核手里接管过来的只读名（`pinax_chapter_list`／`pinax_chapter_read`／`pinax_outline_read`），第 4 个 `pinax_chapter_save` 是板块自有的写入口，写盘必须带 `expectedRevision`（`next/carriers/novel/tools.mjs:178`）。`next/carriers/setting/` 认领 `世界书/约束`，只声明两把同名只读工具（`next/carriers/setting/tools.mjs:175`），**一个写工具都不声明**——世界书写入仍是内核那份，板块的 scopes 里全是 `:r`，所以它连自己的目录都写不动。设定板块的世界书取数只有一条路：`readSettingEntries()`（`next/carriers/setting/context.mjs:85`），上下文块、面板列表、工具返回三处共用同一个函数，不存在能各自漂移的第二份读法。

**工具面聚合。** 运行时连的那一面由 `createRuntimeSurface()` 聚合（`next/runtime/surfaceAggregate.mjs:19`/`:49`）：启用集合里声明过且给了实现的名字才进面，同名＝载体接管，没认领的由内核兜底，声明了却没实现的只进 `withoutImplementation` 记账，绝不虚列一个点了会炸的工具。归属是查询时现算的（`agentRuntime.mjs` 的 `ownerOf`），`callTool` 把 `{tool, owner, payload}` 原样带回来（`next/runtime/agentRuntime.mjs:82`），右栏因此能写清「`pinax_worldbook_list`→`pinax.carrier.setting`」这种点名。全程 in-process，端口仍然为 0。

**运行时上下文与 runner。** `buildRuntimeEnvelope()`（`next/runtime/contextProfiles.mjs:74`）按主载体的上下文档案找**只读**任务（`effectPolicy ∈ review-only/ephemeral/metrics-only`，`shared/agentCapabilityContract.js:39`），映射不到就拒答而不是换一个有写盘副作用的任务；启用集合决定贡献哪些块。小说板块给 `selection/outline`，设定板块给 `rules/style/worldbook`，验收里五块齐（`blocks=rules,style,selection,outline,worldbook task=authoring.review.chapter`）。

**外壳面板。** 新增 `next/shell/CarrierPaneHost.vue`：按 `pane.id` 分发到书稿／正文编辑器／世界书条目／未实现占位四种视图，取数只走一条路——`bridge.request(IPC_CHANNELS.runtimeToolCall)`，渲染层拿不到内核实现（`next/shell/CarrierPaneHost.vue:45`）。编辑器保存发 `{file, text, expectedRevision}`，冲突时把内核原话顶在界面上并拒绝静默合并；左竖条点「书稿」会同时把中栏切到正文编辑器（`next/shell/AppNext.vue:63`）；建项目向导新增伴生板块勾选，默认随行的判据是「scopes 全非 `:rw`」（`next/shell/AppNext.vue:44`）。面板底部 `<details class="pane-meta">` 把这块板块声明的目录／权限／工具名／上下文块原样摊给作者看。

## 2. 实测数字

| 段 | 命令 | 结果 |
| --- | --- | --- |
| 验收（M1 ①–⑦ ＋ M2 ⑧–⑬） | `node next/testing/acceptance.mjs` | **15/15**。真载体靶子建盘骨架齐全；工具面 **20**、载体服务 **6**、`portsOpened=0`；盲写被 `PINAX_STALE_REVISION` 打回、带修订号才落盘（revision 1→2）；世界书读得到 1 条、板块写盘 `PINAX_SCOPE_NOT_GRANTED` 且磁盘无新文件；五块信封走只读任务；装了载体后运行时的写回轨仍是 `.pinax/proposals/`；39551 与 3001 仍无监听 |
| 内核/合同单测 | `node --test "next/tests/*.test.mjs"` | **97/97**（M1 是 75，本批 ＋22：`runtime-context-runner` 10、`carrier-novel` 7、`carrier-setting` 5；另把 `skeleton-contract` 的 M1 那条换成 M2 门禁，数量不变） |
| 外壳界面测 | `vitest run --config next/vitest.next.shell.config.mjs` | **20/20**，三个文件：`shell-ui` 8、`carrier-pane` 9（假信封核交互）、`carrier-pane-real` 3（**一层不 mock**：渲染层→分发器→聚合面→载体工具→内核文件服务→磁盘，含伪造合法内核写调用被 `ERR_PROJECT_NOT_FOUND` 拒且目录清单不变） |
| 源码 lint | `npm run lint:next` | 0 错 0 警（`--max-warnings 0`） |
| 打包门禁 | `node next/testing/bundleAssertions.mjs` | 全过。主进程 bundle **855.5 kB**（M1 772.7 kB，涨的是两份载体）、renderer js **234.6 kB**（M1 206.0 kB）；产物内 `express` 命中 **0**；`import` 产物后仍列 **19** 内核工具；裸导入白名单只剩 `electron`／`node:*`／原生模块 |

源码规模：`next/` 共 **65 个源文件、7889 行**（M1 为 50 个、4662 行）。增量分布：`next/carriers` 942 行／7 文件（新目录）、`next/shell` 1217 行／11 文件、`next/runtime` 785 行／8 文件、`next/tests` 2517 行／15 文件、`next/testing` 454 行／4 文件。

## 3. 门禁口径怎么换的

M1 那条「`next/carriers/` 必须是空的」删了，判据从「不许有插件」换成「插件必须守规矩」。新的四条全在 `next/tests/skeleton-contract.test.mjs:58` 里，逐条机读：随框架发布的只有 novel／setting 两块且清单只写在 `manifest.mjs`（散落 `.carrier.json` 会绕过 C1–C8，直接被拒）；两块认领的目录互不重叠且都落在固化中文骨架的并集里；认领的工具名必须是内核 19 里已有的，载体自有的名字要逐条点名进白名单（今天只有 `pinax_chapter_save`，`next/tests/skeleton-contract.test.mjs:56`）；每块的 `dataDirs` 与 `scopes` 必须一一对应，声明目录却不申请权限、或反过来，都算清单说谎。

归属进度尺也跟着改口径：`toolOwnershipReport()` 现在按**已安装清单**统计（不是启用开关），`claimed 5 ／ unclaimed 14`，且新增断言「认领的名字都有实现」（`next/tests/carrier-setting.test.mjs:78`、`next/tests/runtime-inprocess.test.mjs:118`）。这意味着下一批只要往 `next/carriers/` 里塞一块不守规矩的板块，`verify:next` 就直接红。

## 4. 顺手修掉的一处缺陷

`createNextSession().open()` 之前换项目时不关上一份运行时，只把 `session.runtime` 重新赋值——「新建项目后再打开一次」这种顺序（本批的真链路面板测试正好走它）会在主进程里攒出多余的 in-process MCP 链路。现在 `open()` 与 `refresh()` 同规矩，先 `stop()` 再换（`next/index.mjs:112`）。这条是行为一致性修复，不改变任何对外合同，也没有新增端口。

## 5. 未覆盖项与待裁定（逐条给去处）

1. **一次真模型调用都没打过**。今天「运行时能问」的全部证据是失败信封本身，不是回答。批次 2 第一件实事：在临时项目上真调一次上游，把「回答＋`sourceRefs`＋预算裁剪（`dropped`／`已裁剪`）」摆成证据；上游断了不由我代答，按作者口径另行蒸馏补齐。
2. **内核写族还没被认领，是这批最大的口径缺口**。`pinax_worldbook_write`／`pinax_rule_write`／`pinax_chapter_write`／`pinax_chapter_import`／`pinax_project_init`／`pinax_project_import` 都还挂在面上由内核兜底，而它们的路径解析只看 `projectPath` 或注册表（`server/mcp/localProjects.js:62`）——也就是说模型侧一调用就能往 Next 项目的 `世界书/`、`约束/`、`正文/` 里写文件，绕开板块的 `:r` 权限和修订号闸。本批面板测试里「内核那份被拒」的结论只覆盖了「按 `projectId` 在注册表里找不到」这一支（`carrier-pane-real.spec.mjs` 的伪造调用），不能读成「Next 项目写不进去」。**待作者裁**：批次 2 要么把它们逐块认领进板块（走 `fileService`＋scope＋revision），要么在 Next 会话侧给内核写族加一道「只允许当前 `projectRoot`」的闸。作者机器上《大梦》这类已登记项目尤其踩在这条线上。**（2026-10-27 批次 2 已收口：选的是「加闸」那一支，见 [M2 批次 2 验收记录](./pinax-electron-next-m2-batch2-20261027.md) 第 1、5 节——认领与否仍待作者裁。）**
3. `next/carriers/.gitkeep` 是 M1 空目录时代的残留，现在目录里有真货，它没意义了。删它属于清理不属于交付，本批没动；`skeleton-contract` 里「忽略点文件」那一行是为它留的，删掉 `.gitkeep` 后那行可以一起收掉。
4. **设定板块只做读的一面**：条目检索（关键词命中排序）、关系图、按 `type` 建档都没做，条目超过 1000 个只读前 1000 并进 `warnings`（`next/carriers/setting/context.mjs:148`）。大纲工具已接管但面板还没画树。
5. **真实窗口没肉眼看**：本机 GUI 弹窗你看不见，所以外壳证据是 jsdom 渲染测＋产物文本。第一次真跑 `npm run next:build:renderer && npm run next:shell` 需要人工确认三栏观感、拖拽手感与面板加载态。
6. **Electron ABI 档 / RAG 打包形态 / CI 接线**三条与 M1 记录同状态，未推进：bundle 文本仍不引用 `better-sqlite3`，知识索引链没在打包形态跑过（`PINAX_PYTHON` 的 Windows 坏默认值仍在外层），本工作副本不是 git 仓库所以「提交链路即拦截」要推到真仓库才算落地。

## 6. 复现

```bash
npm run verify:next          # 五段全跑，exit 0
node next/testing/acceptance.mjs                              # 15/15
node --test "next/tests/*.test.mjs"                           # 97/97
npx vitest run --config next/vitest.next.shell.config.mjs      # 20/20
npm run lint:next            # 0 错 0 警
node next/testing/bundleAssertions.mjs                        # 打包门禁
```

## 7. 批次 2 的入口（不在这批做）

顺序建议照第 5 节的账来：先裁内核写族的归属（第 2 条），再把真模型那一调打通并出证据（第 1 条），然后才谈补设定板块的检索与大纲树。夹具轨道仍然活着：`next/testing/fixtures.mjs` 与 `unclaimed 14` 的口径同时被测试钉着，换成真载体后 D4「想玩游戏却没有剧本」那条必须继续绿。
