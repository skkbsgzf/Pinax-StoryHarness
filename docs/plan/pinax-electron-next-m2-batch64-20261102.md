# 批次64 记录：装载原型打桩——pluginLoader fixture（Obsidian 框架轮·桩2 前置）（2026-11-02）

> 工单：`docs/plan/pinax-electron-next-m2-batch64-ticket-20261102.md`（调度方 Zcode，执行方 Qoder CLI）。
> 本批性质＝**可行性判定，不是产品功能**：只在 `node --test` 与 acceptance 里跑，不起 Electron，不接生产装载路。
> 结果：`npm run verify:next` 五段全绿（`EXIT=0`）。**桩判通过——registry 对外部 JSON 清单没有硬障碍，批次65 可以硬推。**
> §8 调度方补。

---

## 1. 四块任务 → 落点

| 任务 | 落点 | 对应测试 |
|---|---|---|
| 1 `next/kernel/pluginLoader.mjs`（新，60 行整） | `loadCarriersFromDir(dir, { registry })`：`readdir(withFileTypes)` 扫 `<dir>/<载体id>/manifest.json` → `JSON.parse` → **同一个** `validateCarrierManifest`（@4 归一校验器，纯函数那份）前置闸 → 通过后按约定 `import('./impl.mjs')` 取实现句柄（无该文件＝空句柄 `{}`）→ `registry.install(manifest, impl, { dir: carrierDir })`；`impl.setup` 走 `registerEffect`、`impl.onDispose` 走 `onDispose`（批次51 合同）。任一清单坏＝该载体记进 `skipped`（带 `stage`/`code`/`reason`），整批不垮；目录不存在／空目录＝空结果不炸；registry 不注入＝只返回装载结果 | `plugin-loader.test.mjs` ①②③ |
| 2 fixture 两份迷你清单＋各一个最小 impl | `next/testing/fixtures/loader-fixture/fixture.loader.good/`（合法 @4：generic 主载体、一枚 center pane、`tools: []`）＋ `impl.mjs`（`setup` 返回 disposer、`dispose`、`onDispose` 全往模块级 `trace` 数组写）；`fixture.loader.bad/`（`id: "BAD-UPPER"` 不过 `PLUGIN_ID_PATTERN`，`version: "1.0"` 双错；其 `impl.setup` 一执行就抛错，作为「坏清单不触 impl」的反证） | ②（trace 只到 `['setup']`） |
| 3 测试四条以上 | `next/tests/plugin-loader.test.mjs`（新，**5 条**）：①合法装入→registry 可见＋`dirOf` 登记；②非法跳过且记账（`stage:'manifest'`／`code:PINAX_INVALID_MANIFEST`）＋`registry.rejected` 为空（前置闸拦下，压根没走到 install）；③空目录／不存在目录→`{loaded:[],skipped:[]}` 不炸＋无 registry 路径返回 manifest/impl；④卸载→dispose 链 `impl.dispose → onDispose 钩子 → 效应回卷` 齐跑（trace 序 `['setup','impl','hook','effect']`），卸后清单不可见、效应栈归零；⑤守卫——pluginLoader ≤60 行且 acceptance 记账条在源上 | ①②③④⑤ |
| 4 acceptance 记账一条 | `next/testing/acceptance.mjs` 批次63 段之后新增「批次64：装载原型打桩」段：真 fixture 目录装入→`registry.get` 可见＋`dirOf` 对→`uninstall` 回执里 `impl`/`hook`/`effect` 三段 dispose 齐且无错→卸后干净。record 名照工单原文「装载原型：fixture 装入→registry 可见→卸载干净」，只记账不打回 | 验收跑第 40 条 |

## 2. 可行性结论（本批的存在理由）

**没有硬障碍。** 工单预警的那种障碍——「impl 必须函数工厂而 JSON 清单给不了」——不存在：

- `registry.install(manifestInput, impl = {}, meta = {})` 的 `impl` 本就是**独立参数**，缺省空对象即可装；清单 JSON 只承载声明面，函数实现另有来路。装载器采用的约定是**载体目录内 `impl.mjs` 默认导出**，由 loader 动态 `import`——这正是批次48 漫画板 `.mjs` 脚本（`preview-server.mjs`/`comfy-mcp-bridge.mjs`）已经在用的资产形状，不算新发明。
- `validateCarrierManifest` 是纯函数无 IO，前置调用与 install 内部校验同源同结果；install 吃原始清单自己归一，loader 不造第二份校验。
- `meta.dir` 落 `pluginDirs`，@4 清单里 services/mcp/entry 的相对路径解析基准现成可用（`registry.dirOf`）。
- 卸载合同（批次51）对外部载体原样兑现：`uninstall` 一条回执里三段 dispose 全可观测。

**给批次65 的形状提示（如实回报，非障碍）**：①纯 JSON 给不了 `commands[].run` 的函数档——清单命令须写字符串实现名（校验器两档都认，外部路只有字符串可用）；②loader 现在把坏清单挡在 install **之前**，`registry.rejected` 只收走到 install 后被拒的（如 TOOL_CONFLICT/DUPLICATE）——批次65 要统一「拒装账」的去向时得带着这条分界；③loader 采用默认 trust（t1），外部目录该给哪档信任是批次65 的设计决定，不是装载器的问题。

## 3. 门禁

`npm run verify:next` **EXIT=0**：验收 **40/40**（＋1 本批记账条）、内核单测 **699/699**（＋5，本批新文件 5 例）、界面测 **200/200**（未动口径）、eslint **0 警**（`--max-warnings 0`）、打包门禁全过（含批次63 前的 a–v 全套，产物标记未动）。
**偶发如实记**：首跑 verify:next 曾被批次61 记账的既有偶发拦红一次（`carrier-pane-real.spec.mjs` 末尾 `MCP error -32000: Connection closed` 未接住 rejection；当轮测试本体 699/699、14 files passed 全绿）；本批未碰该链路，复跑即 EXIT=0——偶发账仍挂批次61 那条，不另立。

## 4. 边界与遵守

- 未改内置 11 块的任何装载方式（那是批次65）；registry 本体一字未动（只消费 install/registerEffect/onDispose/uninstall）；不动外壳／渲染层；不改协议；零 npm 依赖；`server/**`、`src/**` 未碰；未起 Electron；未执行 git。
- 禁止边界内一条没做：`pluginLoader` 只是**可行性原型**，生产装载路（宿主启动时扫外部插件目录）零接线——它当前只被本批测试与 acceptance 消费。

## 5. limitations（做不到／没做的，如实列）

1. `docs/STATUS.md` 未更新——不在本批允许文件清单里，按「只改工单允许的文件」执行；批次记账句请调度方入库时一并补。
2. `registerEffect` 失败（如 EFFECT_ON_DISPOSED 抛出路径）时 loader 只 `skipped` 记账、**不回滚已成功的 install**——桩级别没这个必要，批次65 真装载须定「效应注册失败＝是否整体卸载」。
3. loader 不递归、不认 `node_modules`、不做版本择优／更新检测——工单没要求，桩只证「发现→校验→装入→卸干净」这一条路。
4. 坏清单 fixture 故意用校验闸拦下（`registry.rejected` 空）；「JSON 解析失败」这一支（`stage:'manifest', reason:'清单 JSON 解析失败…'`）由代码路径保证、无独立 fixture（工单只给两份清单配额）。
5. 真窗口、真外部插件目录（作者机器上的 Obsidian 式第三方载体）未验——那是批次65 的产品面。

（§8 调度方验收由 Zcode 补。）
