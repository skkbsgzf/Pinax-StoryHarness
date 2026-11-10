# Pinax-Electron-Next · M1 框架骨架验收记录（2026-10-27）

> 上位文档：[规范 v1](./pinax-electron-next-spec-20261027.md)、[M1 实现方案](./pinax-electron-next-m1-plan-20261027.md)。
> 本档只记「跑出来什么、数字多少、哪些没覆盖」。所有数字来自今天在本机工作副本的实测，可按第 4 节命令复现。

## 0. 结论先行

**M1 判据达成：框架先搭全，不含任何插件，空框架可跑。** 一条命令 `npm run verify:next` 串起五段（空框架验收 7/7、内核单测 75/75、外壳界面测 8/8、`eslint next` 零告警、打包门禁 12/12），exit 0。

搭出来的东西：`next/` 目录 50 个源文件、4662 行，与 `src/`、`server/` 并行且互不引用（有测试盯着这条）。目录以**固化的中文结构为骨架**（`正文/大纲/世界书/构思/资料/日志/约束`），**每个插件板块＝一块新文件夹注册**，认领关系由内核校验，抢别人的目录在装载阶段就被拒。

三件仍然没做成的事，全部如实记账，不粉饰：① 没接模型运行器，运行时栏「问一句话」拿到的是内核拒绝而不是回答；② 服务端 MCP 工具面还不认 `pinax-project@2`，Next 建的项目服务端开不了（一行修复，故意留给 WP7 之后）；③ 外壳的真实 Electron 窗口没在屏幕上看过——GUI 在这台机器上弹出来你也看不见，所以改用 jsdom 渲染测＋产物文本取证两轨替代。

---

## 1. 实测数字

| 段 | 命令 | 结果 |
| --- | --- | --- |
| 空框架验收 | `node next/testing/acceptance.mjs` | **7/7**。裸项目只有 `.pinax/`；打开报 `PINAX_PRIMARY_CARRIER_MISSING`（不回落 novel）；in-process 列 **19** 工具；探测 39551 **无监听**；提问如实报 `PINAX_DEPENDENCY_UNMET`；坏清单被拒后外壳视图仍可用；提案落 `.pinax/proposals/`，`正文` 目录 **0 项** |
| 内核/项目/文件/运行时单测 | `node --test "next/tests/*.test.mjs"` | **75/75**（含 WP4 新增 8 条：槽位保留字、抢右栏被拒、菜单注入被拒、通道命名空间、空框架走通 IPC、装载体后三栏＋提案＋revision 冲突、主载体置顶、渲染侧依赖薄） |
| 外壳界面测 | `vitest run --config next/vitest.next.shell.config.mjs` | **8/8**。三栏齐全＋两个可拖拽分隔条（宽度被 140–360／260–640 夹住）；右栏显示「不可停用·预算优先级 100·工具 19」；无运行器时渲染的是内核拒绝；主载体板块带「主」标记并置顶；向导点选走 `carrier:set-primary` 通道 |
| 源码 lint | `npm run lint:next` | 0 错 0 警（`--max-warnings 0`）。顺带把 `next/.build/**` 加进 eslint ignore——构建产物不参与 lint |
| 打包门禁 | `node next/testing/bundleAssertions.mjs` | **12/12**。内核 bundle **772.7 kB**、外壳 bundle **780.1 kB**，两者裸导入白名单都只剩 `electron`／`node:*`／原生模块；产物内 `express` 命中 **0**；`import` 产物后仍能列出 19 工具（自足可执行，不是"编译通过"）；外壳产物里有 `buildFromTemplate`／`setApplicationMenu`／`ipcMain`；renderer JS **206.0 kB** 且不含 `pinax_project_open`／`createPinaxMcpServer`（渲染层确实是薄的） |

源码规模：`next/kernel` 901 行、`next/fs` 354 行、`next/project` 417 行、`next/runtime` 257 行、`next/shell` 807 行（含 4 个 `.vue`）、`next/testing` 374 行、`next/tests` 1300 行，加根目录入口与构建配置（`index.mjs`／`mainEntry.mjs`／3 份 vite 配置＋1 份 vitest 配置）252 行，共 4662 行、50 个源文件。`next/carriers/` 只有一个 `.gitkeep`——**M1 不随框架发布任何插件**，这条也有测试盯着。

## 2. 这一批补上的东西（WP4 外壳）

`next/shell/`：`menus.mjs`（应用菜单模板，`文件/编辑/视图/运行时/窗口/帮助`）、`slots.mjs`（开放槽位只有 `left-dock`/`center`，`right`/`top-menu` 是带人话理由的保留字）、`ipcContract.mjs`（12 条 `pinax:agent:*` 请求通道＋3 条事件通道，纯函数分发器，主进程与单测共用同一实现）、`main.mjs`（`Menu.setApplicationMenu` 在本仓第一次落地＋`ipcMain.handle` 接线）、`preload.mjs`（`contextBridge` 只暴露 `request`/`onEvent`，通道白名单来自合同）、4 个 `.vue` 组件、`index.html`＋`renderer.mjs`。

两个设计上的取舍记在这里：

**运行时的合同常量拆成叶子模块** `next/runtime/runtimeContract.mjs`。原因不是好看——渲染层要画右栏就必须拿这几个常量，而 `agentRuntime.mjs` 会顺着 `mcpSurface` 拖进整张 MCP 工具面（`server/mcp/*`，其中一个模块在 jsdom 下直接炸 `ERR_INVALID_URL_SCHEME`）。拆开后渲染依赖树里没有内核实现，`f` 号断言与「渲染侧依赖薄」那条单测就是钉这个的。

**运行时不依附项目存在**。`createNextSession` 现在无论项目是否打开成功都会 `ensureRuntime()`：裸项目打开被闸门拦下时，右栏照样活着（19 工具、可提问）。否则「一级公民」就只是在有项目时的说法。

## 3. 未覆盖项（欠账，逐条给了去处）

1. **没接模型运行器**：`runtime.ask()` 走的是 `PINAX_DEPENDENCY_UNMET` 分支。接法已定（`createAgentRuntime({ runner })` 注入主进程内运行器，M2 第一件实事），但今天没有真模型，所以「回答质量」这条完全不成立，不拿模板话冒充。
2. **服务端不认 `pinax-project@2`**：`server/services/localMirrorService.js:496` 的 `ERR_SPEC_MISMATCH` 仍在。改服务端是一行的事（`spec` 白名单加 `@2`），我没动，因为「双向互开」需要服务端侧一起验；`next/tests/legacy-interoperability.test.mjs` 把今天的失败钉成断言，将来谁改了服务端、这条测试会红着提醒补双向用例。
3. **真实窗口没肉眼看**：本机 GUI 弹窗不可见，所以外壳的证据是 jsdom 渲染测＋产物文本，而不是截图。第一次真跑 `npm run next:build:renderer && npm run next:shell` 时需要人工确认三栏观感与拖拽手感。
4. **Electron ABI 档未取证**：`scripts/install-desktop-native-prebuild.cjs:23` 的守卫在本机 Windows 打包时直接 `return`。目前 Next bundle 不引用 `better-sqlite3`（门禁文本已核），所以这条在 M1 不咬人；一旦运行时接了 SQLite（联机/RAG 落盘），出包后必须单独核 `better_sqlite3.node` 的 ABI。
5. **知识索引链（RAG）没在打包形态跑过索引**，`PINAX_PYTHON` 的 Windows 坏默认值也仍在外层（M1 只保证不把它带进 Next）。
6. **M1 门禁挂在 CI**（`.github/workflows/ci.yml` 的 `next-kernel` job 跑 `npm run verify:next`），但本工作副本不是 git 仓库，所以「提交链路即拦截」这条要在真仓库推上去之后才算落地。

## 4. 复现

```bash
npm run verify:next        # 五段全跑，exit 0
npm run next:accept        # 只跑空框架验收
npm run test:next          # 只跑 75 条内核/合同单测
npm run test:next:ui       # 只跑 8 条外壳界面测
npm run lint:next          # 只跑 next/ 的 lint
npm run next:build:main    # 内核 bundle
npm run next:build:shell   # 外壳主进程 bundle
npm run next:build:renderer# 渲染层
```

## 5. M2 的入口（不在这批做）

`next/carriers/` 填第一个真实载体（小说），把 `next/testing/fixtures.mjs` 的夹具清单换成随包发布；同时给运行时接 `runner`。夹具里已经有 `script.scenes` 能力与剧本夹具，D4「想玩游戏却没有剧本」那条用例在 M1 是绿的，M2 换成真载体后必须仍然绿。
