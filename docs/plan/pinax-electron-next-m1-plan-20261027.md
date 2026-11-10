# Pinax-Electron-Next · M1 框架骨架实现方案（2026-10-27）

> 上位文档：[pinax-electron-next-spec-20261027.md](./pinax-electron-next-spec-20261027.md)（规范 v1）。本档只回答"M1 怎么搭、目录长什么样、验收看什么"。
> M1 的定义就是规范第 8 节那条：**框架先搭全，不含任何插件**；判据是"空框架可跑"。
> 本档所有实测数字来自今天的桩脚本，桩产物已全部删除（`tmp-*` 与 `.tmp-next-spike/` 已清，工作副本无残留）。

## 0. 结论先行

1. **两个未验证项都打穿了，可以开工。** in-memory 传输在主进程形态完全跑得通（19 工具全列出、真项目读取全 ok、全程没开任何端口）；`server/` 的服务层能打进主进程 bundle 且产物自足可执行。
2. **但打包侧挖出三个真坑，必须进 M1 的断言，不能留给"以后"**：默认 Vite 构建是浏览器平台，会在 `node:crypto` 上直接炸；SSR 模式下依赖默认外置，而 packager 的忽略规则不放行 npm 依赖，装机后裸导入必断；本机 Windows 打包时原生模块换档脚本直接 return，产物里 sqlite 是什么档全看 `node_modules` 当时的状态。
3. **目录方案：新增 `next/`，与 `src/`、`server/` 并行，互不引用。** 合同与内核放 `next/kernel`，运行时放 `next/runtime`，唯一写盘出口放 `next/fs`，外壳放 `next/shell`，插件槽留空目录 `next/carriers/` 给 M2 起。能复用的现成实现（原子写、上下文包络、MCP 工具面、项目校验器）一律**引用**而非复制。
4. **M1 分七个工作包（WP1–WP7）**，有明确串行依赖：合同与注册表（WP1）→ 文件服务（WP2）→ 运行时进包（WP3）→ 外壳（WP4）→ 项目合同与主载体（WP5）→ 门禁（WP6，可与 WP2–WP5 并行起步）→ 空框架验收（WP7）。
5. **R3/R4 未裁不阻塞 M1。** M1 不碰 localStorage/IndexedDB，也不建任何项目的依赖闭包默认策略；两者分别推到 M2 前与 WP5 收口时。

---

## 1. 桩验证结果（磁盘取证）

| 桩 | 做法 | 实测结果 | 结论 |
| --- | --- | --- | --- |
| 桩 1：in-memory MCP | `createPinaxMcpServer({})` ＋ `InMemoryTransport.createLinkedPair()` ＋ SDK `Client` 直连；`PINAX_APP_DATA`/`PINAX_MIRROR_ROOT` 指向 `os.tmpdir()` 隔离目录 | `listTools` 返回 **19** 个工具；`pinax_project_open`（`D:\Projects\大梦`）ok、`kind=novel`、`name=大梦`；`pinax_chapter_list` 3 章；`pinax_worldbook_list` 13 条；`pinax_outline_read` ok；探测 127.0.0.1:3055 **无监听** | 运行时可以在主进程内以纯函数形态承载整张 MCP 工具面，**不需要 Express、不需要端口**。SDK 版本 1.32.2，`dist/esm/inMemory.js` 提供 `InMemoryTransport.createLinkedPair()` |
| 桩 2a：默认 Vite 构建 | 入口同时引 `electron`＋`server/mcp`＋`server/services`＋`shared`，用普通 `vite build`（lib/es） | **构建失败**：`server/services/localMirrorTransaction.js:3` 的 `createHash` 报 `"createHash" is not exported by "__vite-browser-external"`，368 模块后中止 | 默认平台是浏览器，node 内建被换成浏览器 stub。**主进程构建必须走 SSR/node 平台**（Forge 的 VitePlugin 主进程构建正是这个模式，所以现有 [vite.main.config.mjs](../../vite.main.config.mjs) 没问题——但 Next 新配置若手写就会踩） |
| 桩 2b：SSR 构建 | `build.ssr` ＋ `rollupOptions.external: ['electron','better-sqlite3']` | 成功，28 模块、**233.92 kB**；bundle 里残留裸导入：`@modelcontextprotocol/sdk/server/index.js`、`@modelcontextprotocol/sdk/types.js`（另检出 `ajv`/`ajv-formats`/`zod/v4`） | SSR 模式默认把 npm 依赖**外置**。而 [forge.config.cjs:10-14](../../forge.config.cjs) 的 `packagedRuntimePaths` 只放行 `better-sqlite3 / bindings / file-uri-to-path`，:16-21 的 ignore 会排除其余 `node_modules` → **装机后这些裸导入必断** |
| 桩 2c：SSR ＋ `ssr.noExternal: true` | 同上，加一条 noExternal | 成功，367 模块、**693.96 kB**；bundle 的静态裸导入只剩 `electron` ＋ `node:*`（残留的 `'ajv'` 字样逐行核过，在 SDK 的 JSDoc 注释里，不是活语句）；全文 `express` 命中数 **0** | 依赖能全量内联，服务层与 Express 完全无耦合（`server/services/*.js` 对 express/vue/node:http 的 import 命中数为 0；Express 只出现在 `server/index.js` 与 `server/routes/*`）。**Next 主进程构建的必备两参数就此定死** |
| 桩 2d：产物真跑 | 把无 `electron` 依赖的同款入口打成 bundle，用 Node 直接 `import()` 产物并跑一次 in-memory 往返 | `{"toolCountStatic":19,"listedCount":19,"openOk":true,"openName":"大梦","chapterCount":3,"kinds":["novel","screenplay","generic"]}` | bundle 产物**自足且可执行**，不是"只是编译通过" |
| 桩 3（附带发现）：原生模块换档 | 读 [install-desktop-native-prebuild.cjs:23](../../scripts/install-desktop-native-prebuild.cjs) | 守卫是 `if (platform !== 'win32' || process.platform === 'win32') return`——本机 Windows 打包时**直接返回，不换档** | Windows 出包里 `better_sqlite3.node` 是什么 ABI，完全取决于 `node_modules` 当时的档位（跑过 `electron-forge start` 就是 Electron 档，`npm rebuild` 后是 Node 档）。这是已记录过的"换档陷阱"在打包链上的缺口 |

一条自己的坑也记账：中文路径经 shell 传给 `node -e` 会被编码破坏，导致 `pinax_project_open` 假失败；改成 UTF-8 脚本文件即通。Next 的测试工装一律落文件、不走 `-e` 传参，写进 WP6 的工装规范。

---

## 2. 目录结构（新增 `next/`，与 `src/`、`server/` 并行、互不引用）

```
next/
  kernel/
    pluginRegistry.mjs          # 唯一注册入口 registerPlugin(manifest, impl)；重复 id/越界槽位即拒
    carrierManifest.mjs         # C1–C8 的纯函数校验器（manifest 形态、槽位白名单、dataDirs 合法性）
    capabilityGraph.mjs         # requires/capabilities 传递闭包计算（D3），双向查（启用查上游、停用查下游）
    scopeGrant.mjs              # scope 语法与授予：file:<目录>:rw / agent:ask / net:*，未声明即拒
    capabilities.vocab.mjs      # 能力词表定稿（text.chapters / script.scenes / setting.entries / …）
  runtime/
    agentRuntime.mjs            # 一级公民：主进程内装配，无开关、不进 carriers
    mcpSurface.mjs              # 复用 server/mcp/createMcpServer.js；工具面由各插件 tools 聚合
    transportInProcess.mjs      # InMemoryTransport 链路（渲染进程 ← IPC 命名空间 pinax:agent:*）
    transportStdio.mjs          # 复用 server/mcp/index.js 的 stdio 入口，给外部 Agent/CLI
    contextProfiles.mjs         # 引用 shared/agentContextContract.js ＋ src 的档案优先级口径（不复制合同）
  fs/
    fileService.mjs             # 唯一写盘出口：作用域检查 → 原子写 → 修订并发
    atomicWrite.mjs             # 继承 electron/projects/fsDurability.mjs、projectFiles.mjs 的实现
    projectManifest.mjs         # pinax-project@2 读写（.pinax/project.json 含 carriers{primary,enabled,revision}）
  shell/                        # 渲染层，独立入口，不 import src/ 的任何页面
    main.mjs  AppNext.vue  menus.mjs
    ActivityRail.vue            # 左竖条：条目来自 pluginRegistry，主载体置顶
    CenterSlotHost.vue          # 中栏：插件 pane 挂载点
    RuntimeDock.vue             # 右栏：运行时独占，以孤儿组件 AuthoringDock.vue 的意图为蓝本重写
    slots.mjs                   # 槽位合同：left-dock / center；right 为保留字，插件声明即拒
  project/
    primaryCarrier.mjs          # D1/D2：建项目必选主载体；缺失即 PINAX_PRIMARY_CARRIER_MISSING，禁静默回落
    dependencyGate.mjs          # D3/D4 的调用点与错误载荷（缺口＋修复路径文案）
    archiveView.mjs             # D5：无人声明的既有目录转只读归档
  carriers/                     # M1 留空，只有 .gitkeep ＋ 一条"此目录 M2 起才有内容"的合同测试
  testing/
    harness.mjs                 # 隔离工装：os.tmpdir() 下建 appData/mirrorRoot，脚本一律落文件
    bundleAssertions.mjs        # 见第 4 节断言清单
  vite.next.main.config.mjs     # build.ssr ＋ ssr.noExternal:true ＋ external:['electron']（必写死）
```

复用而不复制的四件现成资产：MCP 工具面 `server/mcp/*`（19 工具不动）、原子写与恢复 `electron/projects/{fsDurability,projectFiles,projectBackup}.mjs`、上下文包络 `shared/agentContextContract.js`、项目校验器 `shared/desktopProjectContract.js`（升级而非另起）。

---

## 3. 七个工作包

**WP1 合同与注册表**（`next/kernel`）：manifest 校验器、`registerPlugin`、槽位白名单、scope 语法、能力词表定稿。判据：单测覆盖 C1–C8 每条各一个拒绝用例；插件声明 `slot:"right"` 或注入顶层菜单被拒且有可见错误载荷。词表不定死，WP5 的闭包校验无法实现（规范第 12 节已记这条）。

**WP2 文件服务**（`next/fs`）：唯一写盘出口，作用域检查挂在原子写之前；中文目录真源。判据：并发改写同一文件时 `expectedRevision` 冲突返回 `STALE_REVISION`；`..`/绝对路径/越界目录三类写入全部被拒；断电恢复用例复用 `recoverInterruptedWrites()` 的现有测试思路。

**WP3 运行时进包**（`next/runtime` ＋ `vite.next.main.config.mjs`）：主进程内装配运行时，双出口 in-memory＋stdio，去掉 `pinax_agent_ask` 的 HTTP 自调用（[agentAsk.js:329](../../server/mcp/agentAsk.js)）。判据：桩 1 与桩 2d 的两条用例进 Next 自己的测试链；产物里除 `electron`/`node:*` 外无裸导入。

**WP4 外壳**（`next/shell` ＋ 主进程菜单）：`Menu` 首次落地（今天整个 `electron/` grep 不到 `Menu`）、左竖条来自注册表、中栏槽位、右运行时栏、三栏可拖拽。判据：**不装任何插件**时外壳可进入、可打开项目、可在运行时栏问一句话；运行时栏无法被插件占用。

**WP5 项目合同与主载体**（`next/project` ＋ 升 `shared/desktopProjectContract.js`）：`pinax-project@2`（`spec` 强制、加 `carriers{primary,enabled,revision}`）、主载体向导、闭包校验与失败界面。判据：Electron 建的项目用服务端 `pinax_project_open` 打开不再 `ERR_SPEC_MISMATCH`（[localMirrorService.js:496](../../server/services/localMirrorService.js)）；主载体为小说、剧本未启用时启用体验，必须失败且给出两条修复路径；代码里 Next 侧不存在 `|| 'novel'` 式回落。

**WP6 门禁与工装**（`next/testing`，可与 WP2–WP5 并行起步）：`npm run verify:next`，按作者口径**必须接在提交链路上**，不是独立 CLI 文档条款。断言至少四条：(a) 主进程构建走 `build.ssr`＋`ssr.noExternal:true`；(b) bundle 裸导入白名单只允许 `electron`/`node:*`；(c) 产物内 `better_sqlite3.node` 的 ABI 是 Electron 档——因为桩 3 查明本机 Windows 打包不做换档，这条只能靠断言兜；(d) 合同单测＋空框架冒烟。

**WP7 空框架验收**：把 WP1–WP6 串成一次可复现的验收跑，并写验收记录（含实测数字与未覆盖项）。判据即 M1 定义：建一个只有 `.pinax/` 的项目、起运行时问一句话、任何插件都不装也不报错。

---

## 4. M1 验收清单（逐条可对，不含任何载体）

1. `npm run verify:next` exit 0。
2. 空框架冒烟：建项目（只有 `.pinax/`）→ 选主载体 → 打开外壳 → 运行时栏发一句话拿到回复 → 全程无端口监听（沿用桩 1 的 portProbe）。
3. bundle 断言：`grep` 产物裸导入 ⊆ {`electron`, `node:*`}；产物内 `express` 命中 0。
4. 合同断言：C1–C8 每条一个拒绝用例；D1–D5 各一个用例。
5. 双向合同断言：Electron↔服务端互开同一项目。
6. 故障隔离断言：故意放一个坏 manifest（越界 dataDirs／抢 right 槽位），外壳仍进入，运行时可用，界面显示"插件 X 未加载"。

## 5. 依赖顺序与并行

WP1 → （WP2 ∥ WP3）→ WP4 → WP5 → WP7；WP6 从 WP1 完成那天起并行。WP3 与 WP6(b) 合起来才能证明"打包后仍能跑"，所以这两包不能各自声称完成。

## 6. M1 明确不做

不填任何插件（`next/carriers/` 保持空）；不改 `src/` 与 `server/routes/`；不迁 localStorage/IndexedDB（R3）；不碰作者原稿目录；不动老 web 首页的 IndexedDB 书；不合入主干、不 push——这些都要单独点头。

## 7. 风险与未验证

- `noExternal: true` 会让主进程 bundle 从 234 kB 涨到 694 kB（未压缩）。生产要不要压缩、要不要拆成多入口，M1 内不做决定，先记账。
- 知识索引链（RAG）在桩 2 里被 `createKnowledgeProjectIndexer` 带进了 bundle，但**没有**在打包形态真跑过索引；它的 `PINAX_PYTHON` 默认值在 Windows 上坏的账仍在（规范第 9 节第 7 条），M1 不解决，只保证不把坏默认值带进 Next。
- 上下文档案优先级目前只验证了"机制存在"（`agentContextResolver.js:17-40`），没验证"运行时优先、插件其次"的预算分配在真模型下表现；模型仍未配置，这条与 `pinax_agent_ask` 的回答质量一起欠着。
- 本次所有数字是**源码树工作副本**实测；`D:\Pinax-main\Pinax-main` 不是 git 仓库，桩脚本已删除，若要复现需按第 1 节"做法"列重建。
